import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { LogicDocument } from './document.js'
import { checkAnchors, type BrokenAnchor } from './library.js'

/** Сколько строк тела показывать: длинный символ съедает контекст целиком. */
const MAX_LINES = 160

export interface BriefAnchor {
  file: string
  symbol: string
  /** Пусто, если якорь сходится с кодом. */
  reason: BrokenAnchor['reason'] | ''
  /** Код под якорем прямо сейчас. Пусто, если его больше нет. */
  source: string
  truncated: boolean
}

export interface Brief {
  path: string
  title: string
  status: string
  body: string
  anchors: BriefAnchor[]
  /** Есть ли вообще что править: якоря, которые не сходятся. */
  stale: boolean
}

interface Placement {
  start_line: number
  end_line: number
}

/** Где символ лежит сейчас, по карте кода. */
function placement(db: DatabaseSync, file: string, symbol: string): Placement | null {
  const stmt = db.prepare(
    `SELECT a.start_line, a.end_line FROM anchors a
     JOIN nodes n ON n.id = a.node_id
     WHERE a.file = ? AND a.symbol = ? AND n.status <> 'removed'
     LIMIT 1`,
  )
  const row = stmt.get(file, symbol) as Placement | undefined
  return row ?? null
}

async function sourceUnder(root: string, file: string, at: Placement): Promise<{ text: string; truncated: boolean }> {
  let content: string
  try {
    content = await readFile(join(root, file), 'utf8')
  } catch {
    return { text: '', truncated: false }
  }

  const lines = content.split(/\r?\n/).slice(at.start_line - 1, at.end_line)
  const truncated = lines.length > MAX_LINES
  return { text: lines.slice(0, MAX_LINES).join('\n'), truncated }
}

/**
 * Собирает всё, чем правится документ: сам документ, состояние каждого якоря и
 * код, который под ним лежит сейчас. Нужно затем, чтобы тому, кто правит,
 * не приходилось искать это по репозиторию руками.
 *
 * Якорь на файл целиком не разворачивается: целый файл в сводке съест больше
 * контекста, чем даст пользы, а документ обычно описывает не весь файл.
 */
export async function buildBrief(db: DatabaseSync, root: string, doc: LogicDocument): Promise<Brief> {
  const broken = checkAnchors(db, doc)
  const anchors: BriefAnchor[] = []

  for (const anchor of doc.anchors) {
    const bad = broken.find((b) => b.file === anchor.file && b.symbol === anchor.symbol)
    const at = anchor.symbol ? placement(db, anchor.file, anchor.symbol) : null

    const code = at ? await sourceUnder(root, anchor.file, at) : { text: '', truncated: false }
    anchors.push({
      file: anchor.file,
      symbol: anchor.symbol,
      reason: bad?.reason ?? '',
      source: code.text,
      truncated: code.truncated,
    })
  }

  return {
    path: doc.path,
    title: doc.title,
    status: doc.status,
    body: doc.body,
    anchors,
    stale: broken.length > 0,
  }
}

const REASON: Record<string, string> = {
  'file-missing': 'файла больше нет',
  'symbol-missing': 'символа больше нет в этом файле',
  drifted: 'код переписали после того, как документ сверяли',
}

/** Сводка текстом, как её читает модель. */
export function formatBrief(brief: Brief): string {
  const out: string[] = [
    `# Документ: ${brief.title}`,
    `# Файл: ${brief.path}`,
    `# Статус: ${brief.status}`,
    '',
    '## Что сейчас написано в документе',
    '',
    brief.body.trim(),
    '',
    '## Якоря и код под ними',
    '',
  ]

  for (const a of brief.anchors) {
    const where = a.symbol ? `${a.file}:${a.symbol}` : a.file
    out.push(a.reason === '' ? `### ${where} - сходится` : `### ${where} - ${REASON[a.reason] ?? a.reason}`)

    if (a.source === '') {
      out.push('', a.symbol ? 'Кода под этим якорем нет.' : 'Якорь на файл целиком, тело не разворачивается.', '')
      continue
    }
    out.push('', '```', a.source, '```')
    if (a.truncated) out.push(`(показаны первые ${MAX_LINES} строк)`)
    out.push('')
  }

  out.push(
    '## Что сделать',
    '',
    'Сверьте описанное поведение с кодом выше.',
    'Изменилось - поправьте документ. Не изменилось - трогать не надо.',
    `В обоих случаях отметьте сверку: aimd2 logic seal ${brief.path}`,
  )

  return out.join('\n')
}
