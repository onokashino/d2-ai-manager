import { Parser } from 'web-tree-sitter'
import { posix } from 'node:path'
import { loadLanguage, languageForPath } from './grammars.js'

interface TsNode {
  type: string
  namedChildCount: number
  namedChild(i: number): TsNode | null
  childForFieldName(name: string): TsNode | null
  text: string
}

export interface ImportBinding {
  /** Имя, под которым символ виден в этом файле. */
  local: string
  /** Имя в модуле-источнике: у `import { a as b }` это `a`. */
  imported: string
  /** Спецификатор модуля, как он написан в исходнике. */
  specifier: string
}

export interface ExtractedImports {
  /** Спецификаторы всех импортов файла: по ним строятся рёбра между файлами. */
  specifiers: string[]
  /** Кто из имён откуда пришёл: по ним вызов находит свой символ в чужом файле. */
  bindings: ImportBinding[]
}

const IMPORT_NODES: Record<string, string[]> = {
  typescript: ['import_statement', 'export_statement'],
  tsx: ['import_statement', 'export_statement'],
  javascript: ['import_statement', 'export_statement'],
  python: ['import_statement', 'import_from_statement'],
}

// Расширения подбираются по языку импортирующего файла. Общий список на все
// языки давал неверное ребро: импорт из .ts разрешался в одноимённый .py.
const SUFFIXES_BY_LANGUAGE: Record<string, string[]> = {
  typescript: ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  tsx: ['', '.tsx', '.ts', '.js', '.jsx', '.mjs', '.cjs'],
  javascript: ['', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],
  python: ['', '.py'],
}

const INDEX_BY_LANGUAGE: Record<string, string[]> = {
  typescript: ['index.ts', 'index.tsx', 'index.js', 'index.jsx'],
  tsx: ['index.tsx', 'index.ts', 'index.js', 'index.jsx'],
  javascript: ['index.js', 'index.jsx', 'index.ts', 'index.tsx'],
  python: ['__init__.py'],
}

// TypeScript в режиме ESM предписывает писать в импорте расширение .js, хотя
// на диске лежит .ts. Без этой подстановки граф импортов любого такого
// проекта, включая этот, остаётся пустым.
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts'],
  '.cjs': ['.cts'],
}

function candidatePaths(base: string, suffixes: string[]): string[] {
  const out = suffixes.map((s) => `${base}${s}`)
  for (const [written, actual] of Object.entries(JS_TO_TS)) {
    if (!base.endsWith(written)) continue
    const stem = base.slice(0, -written.length)
    for (const ext of actual) out.push(`${stem}${ext}`)
  }
  return out
}

function unquote(raw: string): string {
  return raw.replace(/^['"`]/, '').replace(/['"`]$/, '')
}

function childrenOf(node: TsNode): TsNode[] {
  const out: TsNode[] = []
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i)
    if (child) out.push(child)
  }
  return out
}

/**
 * Имена из `import { a, b as c } from './x'`.
 *
 * Импорт по умолчанию и импорт пространством имён пропускаются намеренно: у
 * первого в источнике нет имени, по которому его найти, у второго вызов всегда
 * идёт через точку, а такие мы не отслеживаем.
 */
function namedBindings(clause: TsNode, specifier: string, out: ImportBinding[]): void {
  for (const child of childrenOf(clause)) {
    if (child.type !== 'named_imports') continue
    for (const spec of childrenOf(child)) {
      if (spec.type !== 'import_specifier') continue
      const name = spec.childForFieldName('name')
      if (!name) continue
      const alias = spec.childForFieldName('alias')
      out.push({ local: (alias ?? name).text, imported: name.text, specifier })
    }
  }
}

/** Имена из `from .x import a, b as c`. */
function pythonBindings(node: TsNode, specifier: string, out: ImportBinding[]): void {
  for (const child of childrenOf(node)) {
    if (child.type === 'dotted_name' && child.text !== specifier) {
      out.push({ local: child.text, imported: child.text, specifier })
    } else if (child.type === 'aliased_import') {
      const name = child.childForFieldName('name')
      const alias = child.childForFieldName('alias')
      if (name && alias) out.push({ local: alias.text, imported: name.text, specifier })
    }
  }
}

export async function extractImportSpecifiers(source: string, language: string): Promise<string[]> {
  return (await extractImports(source, language)).specifiers
}

export async function extractImports(source: string, language: string): Promise<ExtractedImports> {
  const empty: ExtractedImports = { specifiers: [], bindings: [] }
  const types = IMPORT_NODES[language]
  if (!types) return empty

  const lang = await loadLanguage(language)
  if (!lang) return empty

  const parser = new Parser()
  let tree
  try {
    parser.setLanguage(lang as never)
    tree = parser.parse(source)
  } catch {
    // setLanguage и parse умеют бросать, и парсер тогда утёк бы вместе со
    // своей памятью в куче WebAssembly. Один плохой файл не роняет скан.
    parser.delete()
    return empty
  }
  if (!tree) {
    parser.delete()
    return empty
  }

  const specifiers: string[] = []
  const bindings: ImportBinding[] = []

  function visit(node: TsNode): void {
    if (types!.includes(node.type)) {
      const sourceField = node.childForFieldName('source')
      const moduleName = node.childForFieldName('module_name')
      if (sourceField) {
        const specifier = unquote(sourceField.text)
        specifiers.push(specifier)
        for (const child of childrenOf(node)) {
          if (child.type === 'import_clause') namedBindings(child, specifier, bindings)
        }
      } else if (moduleName) {
        const specifier = moduleName.text
        specifiers.push(specifier)
        if (node.type === 'import_from_statement') pythonBindings(node, specifier, bindings)
      } else {
        // python хранит имена прямыми детьми без поля, и их может быть
        // несколько: `import os, sys`. Алиас прячет имя внутри себя:
        // `import numpy as np` это aliased_import с полем name.
        for (const child of childrenOf(node)) {
          if (child.type === 'dotted_name' || child.type === 'string') {
            specifiers.push(unquote(child.text))
          } else if (child.type === 'aliased_import') {
            const inner = child.childForFieldName('name')
            if (inner) specifiers.push(inner.text)
          }
        }
      }
    }
    for (const child of childrenOf(node)) visit(child)
  }

  try {
    visit(tree.rootNode as unknown as TsNode)
  } finally {
    // Память дерева и парсера живёт в куче WebAssembly и сборщиком мусора JS
    // не освобождается, а функция вызывается на каждый файл репозитория.
    tree.delete()
    parser.delete()
  }
  return { specifiers, bindings }
}

export function resolveImport(fromFile: string, specifier: string, knownFiles: Set<string>): string | null {
  if (!specifier.startsWith('.')) return null

  const language = languageForPath(fromFile)
  const suffixes = language ? SUFFIXES_BY_LANGUAGE[language] ?? [''] : ['']
  const indexNames = language ? INDEX_BY_LANGUAGE[language] ?? [] : []
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier))

  for (const candidate of candidatePaths(base, suffixes)) {
    if (knownFiles.has(candidate)) return candidate
  }
  for (const index of indexNames) {
    const candidate = posix.join(base, index)
    if (knownFiles.has(candidate)) return candidate
  }
  return null
}
