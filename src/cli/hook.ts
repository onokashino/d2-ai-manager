import { existsSync } from 'node:fs'
import { openDb, closeDb } from '../store/db.js'
import { scanProject } from '../scan/pipeline.js'
import { listDocuments, checkLibrary, DEFAULT_DOCS_DIR } from '../logic/library.js'
import { defaultDbPath } from './paths.js'
import { toPosix } from '../graph/ids.js'

/**
 * Что хук говорит агенту и куда. Claude Code показывает модели обычный вывод
 * только у некоторых событий, а у PostToolUse для этого нужен код возврата два
 * и текст в поток ошибок. Отсюда и три поля вместо одной строки.
 */
export interface HookReply {
  text: string
  stream: 'out' | 'err'
  code: number
}

const SILENT: HookReply = { text: '', stream: 'out', code: 0 }

interface HookInput {
  hook_event_name?: string
  cwd?: string
  /** Откуда началась сессия: startup, resume, clear, compact, fork. */
  source?: string
  /**
   * Claude Code правит файл инструментами Edit и Write и кладёт путь в
   * file_path. Codex правит через apply_patch и кладёт в command целую
   * заплатку, из которой пути надо доставать самому.
   */
  tool_input?: { file_path?: string; command?: string }
}

/** Заголовки файлов в заплатке apply_patch. Одна заплатка трогает несколько. */
const PATCH_FILE = /^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s*(.+?)\s*$/gm

/** Все файлы, которых коснулся вызов, в любой из поддерживаемых консолей. */
export function touchedFiles(tool: HookInput['tool_input']): string[] {
  if (!tool) return []
  if (tool.file_path) return [tool.file_path]
  if (!tool.command) return []

  return [...tool.command.matchAll(PATCH_FILE)].map((m) => (m[1] ?? '').trim()).filter(Boolean)
}

/** Разбирает то, что пришло на вход. Мусор это не повод ломать сессию. */
export function parseHookInput(raw: string): HookInput | null {
  try {
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' ? (value as HookInput) : null
  } catch {
    return null
  }
}

/** Путь относительно корня проекта, каким его пишут в якорях. */
function relative(root: string, raw: string): string {
  const path = toPosix(raw)
  const base = toPosix(root)
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : path
}

/**
 * Правка кода: сказать агенту, что эти файлы держат на себе документы. Базу не
 * трогаем, сверять хеши тут не нужно: достаточно знать, что файл кому-то важен,
 * а хук висит на каждой правке и обязан быть дешёвым.
 */
async function afterEdit(root: string, raw: string[]): Promise<HookReply> {
  if (raw.length === 0) return SILENT

  const files = raw.map((p) => relative(root, p))
  const docs = await listDocuments(root)

  const lines: string[] = []
  for (const file of files) {
    const touched = docs.filter((doc) => doc.anchors.some((a) => a.file === file))
    if (touched.length === 0) continue
    lines.push(`${file}:`)
    for (const doc of touched) lines.push(`  ${doc.title} (${doc.path})`)
  }
  if (lines.length === 0) return SILENT

  return {
    text: [
      'Этот код под якорем документа логики:',
      ...lines,
      'Если поведение изменилось, поправьте документ и отметьте сверку:',
      '  aimd2 logic brief <файл документа>   документ и код под якорями разом',
      '  aimd2 logic seal <файл документа>    отметить, что сверили',
    ].join('\n'),
    // Поток ошибок и код два: у PostToolUse обычный вывод модели не показывают
    // ни Claude Code, ни Codex, а так текст доходит до неё в обеих. Вызов уже
    // состоялся, заблокировать его это не может.
    stream: 'err',
    code: 2,
  }
}

/** Начало сессии: пересчитать карту и назвать документы, разошедшиеся с кодом. */
async function atStart(root: string): Promise<HookReply> {
  const docs = await listDocuments(root)
  if (docs.length === 0) return SILENT

  const dbPath = defaultDbPath(root)
  if (!existsSync(dbPath)) {
    return {
      text: `Документов логики: ${docs.length}, но карта кода не построена. Сверка не работает без неё: aimd2 scan`,
      stream: 'out',
      code: 0,
    }
  }

  // Скан инкрементальный, разбираются только изменившиеся файлы.
  await scanProject({ root, dbPath })

  const db = openDb(dbPath)
  const checked = await checkLibrary(db, root)
  closeDb(db)

  const stale = checked.filter((d) => d.broken.length > 0)
  if (stale.length === 0) return SILENT

  const lines = stale.map((doc) => {
    const why = [...new Set(doc.broken.map(reasonText))].join(', ')
    return `  ${doc.title} (${doc.path}): ${why}`
  })

  return {
    text: [
      `Документы логики разошлись с кодом, их ${stale.length} из ${checked.length}:`,
      ...lines,
      'Чтобы увидеть документ и код под его якорями разом: aimd2 logic brief <файл>',
      'Поправьте те, что описывают изменившееся поведение, остальные отметьте: aimd2 logic seal <файл>',
    ].join('\n'),
    stream: 'out',
    code: 0,
  }
}

function reasonText(anchor: { reason: string }): string {
  if (anchor.reason === 'file-missing') return 'файла нет'
  if (anchor.reason === 'symbol-missing') return 'символа нет'
  return 'код переписали после сверки'
}

/**
 * Одна точка входа на все события: что делать, решает поле hook_event_name.
 * Незнакомое событие и любой сбой дают молчание, потому что сломанный хук не
 * должен мешать работе.
 */
export async function runHook(raw: string, fallbackRoot: string): Promise<HookReply> {
  // Консоль, поднятую нами ради черновика, напоминать ни о чём не нужно: она
  // пошла бы по тому же кругу и позвала бы себя заново.
  if (process.env.AIMD2_BACKGROUND) return SILENT

  const input = parseHookInput(raw)
  if (!input) return SILENT

  const root = input.cwd ?? fallbackRoot
  if (!existsSync(`${root}/${DEFAULT_DOCS_DIR}`)) return SILENT

  try {
    if (input.hook_event_name === 'PostToolUse') return await afterEdit(root, touchedFiles(input.tool_input))
    if (input.hook_event_name === 'SessionStart') {
      // clear и compact случаются посреди сессии, и пересчитывать карту там
      // незачем: код с прошлой проверки не менялся.
      if (input.source === 'clear' || input.source === 'compact') return SILENT
      return await atStart(root)
    }
    return SILENT
  } catch {
    // Карта может быть занята другим процессом или база старой версии. Сессия
    // от этого страдать не должна, а причину человек увидит, запустив aimd2 сам.
    return SILENT
  }
}
