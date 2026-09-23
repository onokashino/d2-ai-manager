import { D2 } from '@terrastruct/d2'

export interface RenderError {
  line: number
  column: number
  message: string
}

/**
 * Доска это отдельная картинка внутри одного документа. D2 умеет три вида, и
 * все три про последовательность действий, а не про структуру:
 *
 *   steps     шаги одного хода: каждый добавляет к предыдущему
 *   scenarios ветка от того же начала: что будет, если пойти иначе
 *   layers    отдельная схема, связанная с этой по смыслу
 */
export interface Board {
  kind: 'steps' | 'scenarios' | 'layers'
  name: string
  /** Чем эта доска называется в запросе на отрисовку. */
  target: string
}

export type RenderResult =
  | { ok: true; svg: string; boards: Board[] }
  | { ok: false; errors: RenderError[] }

interface D2Failure {
  errmsg?: string
}

function parseErrors(error: unknown, lineOffset = 0): RenderError[] {
  const raw = error instanceof Error ? error.message : String(error)
  try {
    const parsed = JSON.parse(raw) as D2Failure[]
    return parsed.map((item) => {
      // Сообщение приходит как "index:12:3: текст", позиция нужна отдельно,
      // чтобы подсветить строку в редакторе.
      const match = /^[^:]*:(\d+):(\d+):\s*(.*)$/.exec(item.errmsg ?? '')
      if (!match) return { line: 0, column: 0, message: item.errmsg ?? raw }
      // Номер строки идёт от начала того, что видел компилятор, а он видел
      // ещё и преамбулу. Редактору нужен номер в исходнике пользователя.
      return {
        line: Math.max(1, Number(match[1]) - lineOffset),
        column: Number(match[2]),
        message: match[3] ?? '',
      }
    })
  } catch {
    return [{ line: 0, column: 0, message: raw }]
  }
}

/**
 * Приписывается к каждому документу перед компиляцией.
 *
 * Подписи на связях d2 по умолчанию пишет мелким курсивом приглушённого цвета,
 * и читать их тяжело. Починить это одним местом в палитре нельзя: глобы не
 * проходят через импорт, проверено. Держать эту строку в каждом документе тоже
 * плохо, она про оформление, а документ про логику. Поэтому правило живёт
 * здесь, а файлы остаются чистыми и валидными d2.
 */
const PRELUDE = '(** -> **)[*].style: { italic: false; font-size: 15; font-color: "#e4e4e4" }'

/** На сколько строк преамбула сдвигает номера строк в сообщениях компилятора. */
const PRELUDE_LINES = PRELUDE.split('\n').length

let shared: D2 | null = null

function engine(): D2 {
  // Один экземпляр на процесс: инициализация WASM занимает около секунды,
  // и платить её на каждый документ незачем.
  if (!shared) shared = new D2()
  return shared
}

export type Layout = 'dagre' | 'elk'
export type Appearance = 'dark' | 'light'

// Тема диаграммы идёт следом за темой интерфейса: белое полотно посреди тёмного
// экрана выглядит чужеродно. 200 это тёмная тема D2, 0 это обычная светлая.
const THEME_ID: Record<Appearance, number> = { dark: 200, light: 0 }

export async function renderDiagram(
  source: string,
  layout: Layout = 'dagre',
  appearance: Appearance = 'dark',
  /**
   * Соседние файлы, видимые документу. Нужны для строки `...@_palette`:
   * общий словарь форм и цветов лежит отдельным файлом, а документ остаётся
   * обычным d2, который откроет любой сторонний инструмент.
   */
  neighbours: Record<string, string> = {},
  /** Какую доску рисовать. Пусто это корень документа. */
  target = '',
): Promise<RenderResult> {
  if (source.trim() === '') return { ok: true, svg: '', boards: [] }
  try {
    const d2 = engine()
    const compiled = await d2.compile({
      fs: { ...neighbours, 'index.d2': `${PRELUDE}\n${source}` },
      inputPath: 'index.d2',
      options: { layout },
    })

    const boards = listBoards(compiled.diagram)
    // Доска могла исчезнуть, пока её выбирали: документ правят прямо в студии,
    // и просьба нарисовать несуществующее не должна выглядеть как ошибка.
    const wanted = boards.some((b) => b.target === target) ? target : ''

    // Тема задаётся именно здесь: в опциях компиляции d2 её игнорирует и
    // возвращает themeID равным нулю, проверено на месте.
    // noXMLTag: svg вставляется прямо в страницу, и пролог там лишний.
    // pad поменьше: поля рисует уже сам просмотрщик.
    const svg = await d2.render(compiled.diagram, {
      ...compiled.renderOptions,
      themeID: THEME_ID[appearance],
      noXMLTag: true,
      pad: 24,
      ...(wanted ? { target: wanted } : {}),
    })
    return { ok: true, svg, boards }
  } catch (error) {
    return { ok: false, errors: parseErrors(error, PRELUDE_LINES) }
  }
}

interface NamedBoard {
  name?: string
}

/** Доски документа в том порядке, в каком их читают: шаги, ветки, слои. */
function listBoards(diagram: { steps?: unknown; scenarios?: unknown; layers?: unknown }): Board[] {
  const collect = (kind: Board['kind'], list: unknown): Board[] =>
    (Array.isArray(list) ? (list as NamedBoard[]) : [])
      .map((b, i) => {
        const name = b?.name ?? String(i + 1)
        return { kind, name, target: `${kind}.${name}` }
      })

  return [
    ...collect('steps', diagram.steps),
    ...collect('scenarios', diagram.scenarios),
    ...collect('layers', diagram.layers),
  ]
}

export function asLayout(raw: string | null | undefined): Layout {
  return raw === 'elk' ? 'elk' : 'dagre'
}

export function asAppearance(raw: string | null | undefined): Appearance {
  return raw === 'light' ? 'light' : 'dark'
}

/**
 * Освобождает воркер D2. Без этого процесс не завершается: воркер держит
 * событийный цикл открытым.
 */
export async function closeRenderer(): Promise<void> {
  const current = shared
  shared = null
  if (!current) return
  const maybe = current as unknown as { worker?: { terminate?: () => unknown } }
  await maybe.worker?.terminate?.()
}
