import { toPosix } from '../graph/ids.js'
import { parseFlow, formatFlow, type FlowStep } from './flow.js'

export type DocStatus = 'draft' | 'review' | 'approved' | 'outdated'

export interface DocAnchor {
  file: string
  symbol: string
  /**
   * Хеш кода под якорем на тот момент, когда документ с ним сверяли. Пусто,
   * если не сверяли ни разу. Живёт в самом файле, а не в базе: база локальная
   * и пересобирается сканом, а документ уезжает в репозиторий, и на свежем
   * клоне сверять было бы не с чем.
   */
  fingerprint: string
}

export type CheckedBy = 'agent' | 'human'

/** Кто в последний раз сверял документ с кодом и когда. */
export interface Checked {
  by: CheckedBy
  on: string
}

export interface LogicDocument {
  /** Путь файла относительно корня проекта, он же идентификатор документа. */
  path: string
  title: string
  status: DocStatus
  area: string
  summary: string
  updated: string
  /**
   * Кто сверял документ с кодом. Пусто, если не сверял никто.
   *
   * Без этого поля нельзя ответить на главный вопрос о доверии: документ,
   * который агент и написал, и сам объявил верным, выглядел ровно так же, как
   * прочитанный человеком.
   */
  checked: Checked | null
  /** На какой код опирается документ. Пусто, если документ ни к чему не привязан. */
  anchors: DocAnchor[]
  /**
   * Ход поведения через код: цепочка символов, каждый из которых зовёт
   * следующий. Пусто, если документ описывает устройство, а не порядок.
   *
   * Якоря отвечают, правда ли ещё каждая точка по отдельности. Ход отвечает на
   * то, чего якоря не видят: точки на месте, а связь между ними исчезла или
   * посередине появился новый шаг.
   */
  flow: FlowStep[]
  /** Тело документа на языке D2, без шапки. */
  body: string
}

const STATUSES = new Set<DocStatus>(['draft', 'review', 'approved', 'outdated'])

function parseChecked(raw: string): Checked | null {
  const match = /^(agent|human)\s+(\S+)$/.exec(raw.trim())
  if (!match) return null
  return { by: match[1] as CheckedBy, on: match[2] as string }
}

/** Ровно столько шестнадцатеричных знаков отдаёт hashContent. */
const FINGERPRINT = /@([0-9a-f]{16})$/

function parseAnchor(raw: string): DocAnchor | null {
  let text = raw.trim()
  if (!text) return null

  // Отпечаток пишется в хвосте через собачку. Условие строгое: ровно шестнадцать
  // шестнадцатеричных знаков в самом конце, иначе под него подошёл бы обычный
  // путь вроде node_modules/@abc.
  let fingerprint = ''
  const stamp = FINGERPRINT.exec(text)
  if (stamp) {
    fingerprint = stamp[1] as string
    text = text.slice(0, stamp.index)
  }

  // Якорь пишется как "файл:символ", причём символ необязателен. Двоеточие
  // ищется с конца: в пути диска оно тоже встречается.
  const cut = text.lastIndexOf(':')
  if (cut <= 0) return { file: toPosix(text), symbol: '', fingerprint }
  return { file: toPosix(text.slice(0, cut)), symbol: text.slice(cut + 1).trim(), fingerprint }
}

/** Якорь строкой, как он лежит в шапке файла. */
export function formatAnchor(a: DocAnchor): string {
  const base = a.symbol ? `${a.file}:${a.symbol}` : a.file
  return a.fingerprint ? `${base}@${a.fingerprint}` : base
}

/**
 * Разбирает документ логики. Шапка это ведущие строки вида "# ключ: значение",
 * всё остальное это тело на D2. Неизвестные ключи шапки сохраняются в теле,
 * чтобы правка чужого файла ничего не теряла.
 */
export function parseDocument(path: string, source: string): LogicDocument {
  const lines = source.split(/\r?\n/)
  const head = new Map<string, string>()

  let i = 0
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (line.trim() === '') {
      if (head.size === 0) continue
      i += 1
      break
    }
    const match = /^#\s*([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (!match) break
    head.set(match[1]!.toLowerCase(), (match[2] ?? '').trim())
  }

  const rawStatus = (head.get('status') ?? '').toLowerCase()
  const anchors = (head.get('anchors') ?? '')
    .split(',')
    .map(parseAnchor)
    .filter((a): a is DocAnchor => a !== null)

  return {
    path: toPosix(path),
    title: head.get('title') ?? toPosix(path).split('/').pop() ?? path,
    status: STATUSES.has(rawStatus as DocStatus) ? (rawStatus as DocStatus) : 'draft',
    area: head.get('area') ?? '',
    summary: head.get('summary') ?? '',
    updated: head.get('updated') ?? '',
    checked: parseChecked(head.get('checked') ?? ''),
    anchors,
    flow: parseFlow(head.get('flow') ?? ''),
    body: lines.slice(i).join('\n'),
  }
}

/** Собирает документ обратно в файл. Шапка пишется в том же порядке всегда. */
export function serializeDocument(doc: LogicDocument): string {
  // Каждое поле шапки это одна строка комментария. Перенос внутри значения
  // уехал бы в тело документа и сломал файл, поэтому схлопывается в пробел.
  const line = (value: string) => value.replace(/\s*\r?\n\s*/g, ' ').trim()

  const head = [
    `# title: ${line(doc.title)}`,
    `# status: ${doc.status}`,
    `# area: ${line(doc.area)}`,
    `# summary: ${line(doc.summary)}`,
    `# updated: ${line(doc.updated)}`,
  ]
  if (doc.checked) head.push(`# checked: ${doc.checked.by} ${doc.checked.on}`)
  if (doc.anchors.length > 0) {
    const anchors = doc.anchors.map(formatAnchor).join(', ')
    head.push(`# anchors: ${anchors}`)
  }
  if (doc.flow.length > 0) head.push(`# flow: ${formatFlow(doc.flow)}`)
  const body = doc.body.replace(/^\n+/, '')
  return `${head.join('\n')}\n\n${body}${body.endsWith('\n') ? '' : '\n'}`
}
