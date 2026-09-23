import { open, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, isAbsolute, relative } from 'node:path'
import { toPosix } from '../graph/ids.js'

/** Один заход: что просил человек, что надумал агент и какие файлы он тронул. */
export interface Turn {
  text: string
  files: string[]
}

const PROJECTS = join(homedir(), '.claude', 'projects')

// Запись сессии растёт до десятков мегабайт, а читать её нужно после каждого
// ответа. Целиком она не читается никогда: берётся хвост, и этого хватает,
// потому что нужен только последний заход.
const TAIL_BYTES = 2 * 1024 * 1024

/**
 * Файл записи по идентификатору сессии.
 *
 * Ищется перебором каталогов, а не вычислением имени: имя каталога это путь
 * проекта с заменёнными разделителями, и правило замены нигде не обещано.
 * Идентификатор сессии уникален, поэтому перебор надёжнее догадки.
 */
export async function findTranscript(sessionId: string): Promise<string | null> {
  if (!/^[\w-]+$/.test(sessionId)) return null
  let dirs: string[]
  try {
    dirs = await readdir(PROJECTS)
  } catch {
    return null
  }
  for (const dir of dirs) {
    const candidate = join(PROJECTS, dir, `${sessionId}.jsonl`)
    try {
      await stat(candidate)
      return candidate
    } catch {
      // Такой сессии в этом проекте нет, это обычное дело.
    }
  }
  return null
}

async function readTail(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const from = size > TAIL_BYTES ? size - TAIL_BYTES : 0
    const buffer = Buffer.alloc(size - from)
    await handle.read(buffer, 0, buffer.length, from)
    const text = buffer.toString('utf8')
    // Первая строка обрезана посередине, если читали не с начала файла.
    return from === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } finally {
    await handle.close()
  }
}

interface Block {
  type?: string
  text?: string
  thinking?: string
  name?: string
  input?: { file_path?: string }
}

interface Entry {
  type?: string
  isMeta?: boolean
  isSidechain?: boolean
  message?: { role?: string; content?: string | Block[] }
}

function blocksOf(entry: Entry): Block[] {
  const content = entry.message?.content
  return Array.isArray(content) ? content : []
}

/** Человеческая реплика, а не служебная запись и не ответ инструмента. */
function isHuman(entry: Entry): boolean {
  return entry.type === 'user' && !entry.isMeta && typeof entry.message?.content === 'string'
}

const EDITORS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

function relativeTo(root: string, raw: string): string | null {
  if (!raw) return null
  const path = isAbsolute(raw) ? relative(root, raw) : raw
  // Файл за пределами проекта документов не касается. Проверок две: путь через
  // две точки это сосед по дереву, а остаться абсолютным путь может на другом
  // диске, где общего корня нет вовсе и relative возвращает цель как есть.
  if (!path || path.startsWith('..') || isAbsolute(path)) return null
  return toPosix(path)
}

/**
 * Последний заход из записи сессии.
 *
 * Заход это реплика человека и всё, что агент сделал после неё. Берётся именно
 * он, а не весь разговор: документ должен описывать то, что решили сейчас, и
 * тащить в подсказку вчерашние темы значит сбивать модель.
 *
 * В текст попадают и блоки рассуждений. Из одного диффа не видно, почему код
 * стал таким, а документ логики отвечает как раз на "почему".
 */
export async function readLastTurn(path: string, root: string, budget = 12000): Promise<Turn> {
  let tail: string
  try {
    tail = await readTail(path)
  } catch {
    return { text: '', files: [] }
  }

  const entries: Entry[] = []
  for (const line of tail.split('\n')) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line) as Entry)
    } catch {
      // Оборванная или чужая строка: пропускаем, а не роняем всё чтение.
    }
  }

  let start = entries.length - 1
  for (; start >= 0; start -= 1) {
    const entry = entries[start] as Entry
    if (!entry.isSidechain && isHuman(entry)) break
  }
  const turn = entries.slice(start < 0 ? 0 : start)

  const parts: string[] = []
  const files: string[] = []
  const seen = new Set<string>()

  for (const entry of turn) {
    // Подагенты идут своей веткой и к этому заходу отношения не имеют.
    if (entry.isSidechain) continue

    if (isHuman(entry)) {
      parts.push(`Человек: ${entry.message?.content as string}`)
      continue
    }
    if (entry.type !== 'assistant') continue

    for (const block of blocksOf(entry)) {
      if (block.type === 'text' && block.text) parts.push(`Агент: ${block.text}`)
      else if (block.type === 'thinking' && block.thinking) parts.push(`Агент размышляет: ${block.thinking}`)
      else if (block.type === 'tool_use' && block.name && EDITORS.has(block.name)) {
        const file = relativeTo(root, block.input?.file_path ?? '')
        if (file && !seen.has(file)) {
          seen.add(file)
          files.push(file)
        }
      }
    }
  }

  // Урезается начало, а не конец: ближе к концу лежит то, к чему разговор
  // пришёл, и оно важнее того, с чего начинали.
  let text = parts.join('\n\n')
  if (text.length > budget) text = `...\n\n${text.slice(text.length - budget)}`
  return { text, files }
}
