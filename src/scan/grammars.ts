import { existsSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Parser, Language } from 'web-tree-sitter'

export const GRAMMAR_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'vendor', 'grammars')

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rs': 'rust',
}

const cache = new Map<string, unknown | null>()
let initialized = false

export function languageForPath(p: string): string | null {
  return EXT_TO_LANG[extname(p).toLowerCase()] ?? null
}

/**
 * Каталог грамматик перекрывается параметром: иначе тесту, которому нужен
 * заведомо битый wasm, пришлось бы писать его в поставляемый vendor/grammars,
 * то есть npm test правил бы дерево пакета.
 */
export async function loadLanguage(name: string, dir: string = GRAMMAR_DIR): Promise<unknown | null> {
  // Каталог входит в ключ кеша, иначе одно имя из разных каталогов делило бы
  // одну запись.
  const key = `${dir}\u0000${name}`
  if (cache.has(key)) return cache.get(key) ?? null

  const wasm = join(dir, `tree-sitter-${name}.wasm`)
  if (!existsSync(wasm)) {
    cache.set(key, null)
    return null
  }

  try {
    if (!initialized) {
      await Parser.init()
      initialized = true
    }
    const lang = await Language.load(wasm)
    cache.set(key, lang)
    return lang
  } catch {
    // Битый или несовместимый wasm, либо сбой инициализации рантайма
    // tree-sitter, не должны ронять скан.
    cache.set(key, null)
    return null
  }
}
