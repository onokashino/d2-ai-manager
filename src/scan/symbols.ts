import { Parser } from 'web-tree-sitter'
import { loadLanguage } from './grammars.js'
import { hashContent } from './hash.js'

export type SymbolKind = 'function' | 'class' | 'method' | 'interface'

export interface ExtractedSymbol {
  symbolPath: string
  name: string
  kind: SymbolKind
  startLine: number
  endLine: number
  /**
   * Хеш тела символа. Пробелы схлопываются перед подсчётом: переформатирование
   * не должно выглядеть как правка поведения, иначе документы логики начнут
   * помечаться разошедшимися после каждого прогона форматтера.
   */
  bodyHash: string
}

export interface CallSite {
  /** Путь символа, внутри которого стоит вызов. Пусто, если вызов на верхнем уровне модуля. */
  from: string
  /** Имя вызываемого. */
  callee: string
}

/**
 * Определения и вызовы одного файла, снятые за один проход дерева.
 *
 * Вместе, а не двумя функциями, потому что у вызова должен быть путь символа,
 * внутри которого он стоит, и посчитан он обязан быть ровно так же, как у
 * определения. Второй обход с копией тех же правил разошёлся бы с первым при
 * первой же правке, и рёбра вызовов перестали бы находить свои узлы.
 */
export interface Outline {
  symbols: ExtractedSymbol[]
  calls: CallSite[]
}

interface TsNode {
  type: string
  startPosition: { row: number }
  endPosition: { row: number }
  namedChildCount: number
  namedChild(i: number): TsNode | null
  childForFieldName(name: string): TsNode | null
  text: string
}

interface Scope {
  name: string
  /** `scope` означает область имён, которая сама символом не является. */
  kind: SymbolKind | 'scope'
}

// Тип `class` это анонимное классовое выражение. Без него узел не считался бы
// определением, и его методы всплывали бы в объемлющую область с чужим путём.
const DEFINITIONS: Record<string, Record<string, SymbolKind>> = {
  typescript: {
    function_declaration: 'function',
    class_declaration: 'class',
    class: 'class',
    method_definition: 'method',
    interface_declaration: 'interface',
    // Объединение строк это чаще всего и есть описываемое поведение: набор
    // статусов, кодов, видов. Без них на такой словарь нельзя поставить
    // якорь, и документ про статусы не с чем сверять.
    type_alias_declaration: 'interface',
    enum_declaration: 'interface',
  },
  tsx: {
    function_declaration: 'function',
    class_declaration: 'class',
    class: 'class',
    method_definition: 'method',
    interface_declaration: 'interface',
    type_alias_declaration: 'interface',
    enum_declaration: 'interface',
  },
  javascript: {
    function_declaration: 'function',
    class_declaration: 'class',
    class: 'class',
    method_definition: 'method',
  },
  python: {
    function_definition: 'function',
    class_definition: 'class',
  },
  rust: {
    function_item: 'function',
    // Объявление метода в трейте: тела нет, но поведение описывается именно им.
    function_signature_item: 'function',
    struct_item: 'class',
    enum_item: 'class',
    trait_item: 'interface',
  },
}

/**
 * Узлы, которые добавляют к пути символа, но сами символом не являются.
 *
 * У Rust два таких. `mod` это область имён внутри файла: без неё функция из
 * `mod tests` и одноимённая функция верхнего уровня дали бы один путь, то есть
 * один узел на две разные вещи. `impl` объявлением типа не является, тип
 * объявлен рядом в `struct`, и если считать его определением, оба получат
 * одинаковый путь и одинаковый вид. Зато вид `class` у этой области нужен:
 * по нему функции внутри становятся методами.
 */
const SCOPES: Record<string, Record<string, SymbolKind | 'scope'>> = {
  rust: { mod_item: 'scope', impl_item: 'class' },
}

// Узел вызова и поле, в котором лежит вызываемое. Разбирается только голый
// идентификатор: `place()` и `new Order()`. Вызов через точку, `service.place()`,
// намеренно пропускается, потому что статически определить, чем окажется
// `service`, в общем случае нельзя, а ребро наугад дороже отсутствующего: по
// ложной связи документ объявят разошедшимся там, где ничего не менялось.
const CALLS: Record<string, Record<string, string>> = {
  typescript: { call_expression: 'function', new_expression: 'constructor' },
  tsx: { call_expression: 'function', new_expression: 'constructor' },
  javascript: { call_expression: 'function', new_expression: 'constructor' },
  python: { call: 'function' },
  rust: { call_expression: 'function' },
}

/** Текст символа без разницы в пробелах: только по нему считается хеш тела. */
export function normalizeBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export async function extractSymbols(source: string, language: string): Promise<ExtractedSymbol[]> {
  return (await extractOutline(source, language)).symbols
}

export async function extractOutline(source: string, language: string): Promise<Outline> {
  const empty: Outline = { symbols: [], calls: [] }
  const defs = DEFINITIONS[language]
  if (!defs) return empty

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

  const calls = CALLS[language] ?? {}
  const scopes = SCOPES[language] ?? {}
  const symbols: ExtractedSymbol[] = []
  // Один и тот же вызов в теле функции встречается помногу раз, а ребро из
  // него выходит одно. Пара отсеивается здесь, чтобы список не рос впустую.
  const seen = new Set<string>()
  const found: CallSite[] = []

  function visit(node: TsNode, prefix: Scope[], anonymous: { count: number }): void {
    let kind = defs![node.type]
    let nextPrefix = prefix
    let nextAnonymous = anonymous

    // Область имён только углубляет путь: своего узла у неё нет.
    const scope = scopes[node.type]
    if (scope) {
      const named = node.childForFieldName('name') ?? node.childForFieldName('type')
      if (named) {
        nextPrefix = [...prefix, { name: named.text, kind: scope }]
        nextAnonymous = { count: 0 }
      }
    }

    // method_definition это ещё и метод объектного литерала, а он не символ
    // модуля: его имя ничего не значит вне литерала. Попав в карту, он и сорит
    // в ней, и сталкивается с одноимённой функцией верхнего уровня, потому что
    // путь символа у обоих одинаковый. Дети всё равно обходятся: внутри метода
    // литерала может лежать настоящий класс.
    if (node.type === 'method_definition' && prefix[prefix.length - 1]?.kind !== 'class') {
      kind = undefined
    }

    if (kind) {
      const nameNode = node.childForFieldName('name')
      // Безымянные определения нумеруются в пределах своей области: иначе два
      // анонимных класса в одном файле дали бы детям одинаковый путь, а значит
      // и один идентификатор узла на две разные сущности.
      const name = nameNode ? nameNode.text : `(anonymous ${(anonymous.count += 1)})`
      const symbolPath = [...prefix.map((s) => s.name), name].join('/')
      // Python объявляет методы тем же function_definition, что и обычные
      // функции, поэтому вид уточняется по ближайшей объемлющей сущности.
      // Функция внутри функции остаётся функцией, методом её делает только класс.
      const enclosing = prefix[prefix.length - 1]
      const inType = enclosing?.kind === 'class' || enclosing?.kind === 'interface'
      const effective: SymbolKind = kind === 'function' && inType ? 'method' : kind
      symbols.push({
        symbolPath,
        name,
        kind: effective,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        bodyHash: hashContent(normalizeBody(node.text)),
      })
      nextPrefix = [...prefix, { name, kind: effective }]
      nextAnonymous = { count: 0 }
    }

    const field = calls[node.type]
    if (field) {
      const callee = node.childForFieldName(field)
      if (callee && callee.type === 'identifier') {
        // Область берётся внешняя, а не nextPrefix: вызов принадлежит тому
        // символу, в теле которого стоит, и определением сам не является.
        const from = prefix.map((s) => s.name).join('/')
        const key = `${from}\u0000${callee.text}`
        if (!seen.has(key)) {
          seen.add(key)
          found.push({ from, callee: callee.text })
        }
      }
    }

    for (let i = 0; i < node.namedChildCount; i += 1) {
      const child = node.namedChild(i)
      if (child) visit(child, nextPrefix, nextAnonymous)
    }
  }

  try {
    visit(tree.rootNode as unknown as TsNode, [], { count: 0 })
  } finally {
    // Дерево и парсер держат память в куче WebAssembly, сборщик мусора JS её
    // не освобождает. Функция вызывается на каждый файл репозитория.
    tree.delete()
    parser.delete()
  }
  return { symbols, calls: found }
}
