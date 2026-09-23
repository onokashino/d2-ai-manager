import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_DOCS_DIR } from './library.js'

export interface PaletteClass {
  name: string
  shape: string
  /** Комментарий над классом: он и есть подсказка о том, когда класс уместен. */
  hint: string
  /** Цвета нужны легенде, чтобы образец выглядел так же, как узел на схеме. */
  fill: string
  stroke: string
  /** Раздел палитры: роли узлов и роли связей показываются раздельно. */
  group: string
}

export const PALETTE_FILE = '_palette.d2'

/**
 * Достаёт список классов из палитры. Подсказки редактора берутся отсюда, а не
 * из жёсткого списка в коде: иначе они разойдутся с палитрой при первой правке.
 */
export async function readPalette(root: string, docsDir = DEFAULT_DOCS_DIR): Promise<PaletteClass[]> {
  let source: string
  try {
    source = await readFile(join(root, docsDir, PALETTE_FILE), 'utf8')
  } catch {
    return []
  }

  const lines = source.split(/\r?\n/)
  const start = lines.findIndex((l) => /^\s*classes\s*:\s*\{/.test(l))
  if (start === -1) return []

  const out: PaletteClass[] = []
  let comment = ''
  let group = 'Узлы'

  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (/^\}/.test(line)) break

    // Две решётки это заголовок раздела, а не подпись класса: по нему легенда
    // разделяет роли узлов и роли связей.
    const groupMatch = /^\s*##\s*(.+)$/.exec(line)
    if (groupMatch) {
      group = (groupMatch[1] ?? '').trim()
      comment = ''
      continue
    }

    const commentMatch = /^\s*#\s?(.*)$/.exec(line)
    if (commentMatch) {
      // Берётся только первая строка: дальше идут заметки для того, кто правит
      // палитру, а в легенде нужна короткая подпись про роль.
      if (!comment) comment = commentMatch[1] ?? ''
      continue
    }

    const nameMatch = /^\s{2}([a-z][\w-]*)\s*:\s*\{/.exec(line)
    if (!nameMatch) {
      if (line.trim() === '') comment = ''
      continue
    }

    // Форма и цвета могут стоять в той же строке или ниже, до закрывающей скобки.
    let shape = ''
    let fill = ''
    let stroke = ''
    let depth = 1
    for (let j = i; j < lines.length && depth > 0; j += 1) {
      const inner = lines[j] ?? ''
      if (j > i) {
        depth += (inner.match(/\{/g) ?? []).length
        depth -= (inner.match(/\}/g) ?? []).length
      }
      const shapeMatch = /\bshape\s*:\s*([a-z_]+)/.exec(inner)
      if (shapeMatch && !shape) shape = shapeMatch[1] ?? ''
      const fillMatch = /\bfill\s*:\s*"([^"]+)"/.exec(inner)
      if (fillMatch && !fill) fill = fillMatch[1] ?? ''
      const strokeMatch = /\bstroke\s*:\s*"([^"]+)"/.exec(inner)
      if (strokeMatch && !stroke) stroke = strokeMatch[1] ?? ''
      if (depth <= 0) break
    }

    out.push({
      name: nameMatch[1] ?? '',
      shape: shape || 'rectangle',
      hint: comment.trim(),
      fill,
      stroke,
      group,
    })
    comment = ''
  }

  return out
}

/** Формы D2, которые имеет смысл предлагать в подсказках. */
export const D2_SHAPES = [
  'rectangle', 'square', 'page', 'parallelogram', 'document', 'cylinder',
  'queue', 'package', 'step', 'callout', 'stored_data', 'person', 'diamond',
  'oval', 'circle', 'hexagon', 'cloud', 'text', 'code', 'class', 'sql_table',
  'sequence_diagram',
]

/** Ключевые слова языка для подсветки и подсказок. */
export const D2_KEYWORDS = [
  'shape', 'style', 'class', 'classes', 'vars', 'direction', 'label', 'icon',
  'link', 'tooltip', 'near', 'width', 'height', 'constraint', 'grid-rows',
  'grid-columns', 'grid-gap', 'layers', 'scenarios', 'steps', 'fill', 'stroke',
  'stroke-width', 'stroke-dash', 'opacity', 'shadow', 'font-color', 'font-size',
  'bold', 'italic', 'border-radius', 'double-border', 'multiple', 'animated',
  '3d', 'text-transform',
]
