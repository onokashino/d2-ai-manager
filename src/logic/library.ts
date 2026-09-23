import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { toPosix } from '../graph/ids.js'
import {
  parseDocument,
  type DocAnchor,
  type DocStatus,
  type CheckedBy,
  type LogicDocument,
} from './document.js'

export const DEFAULT_DOCS_DIR = 'docs/logic'

export interface BrokenAnchor extends DocAnchor {
  /**
   * Почему якорь не сходится. Первые два это исчезнувший код, третье хуже:
   * код на месте, но его переписали после того, как документ с ним сверяли,
   * а значит документ может описывать поведение, которого уже нет.
   */
  reason: 'file-missing' | 'symbol-missing' | 'drifted'
}

export interface CheckedDocument extends LogicDocument {
  broken: BrokenAnchor[]
}

async function collect(dir: string, root: string, out: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // Каталога с документами может не быть, это не ошибка: он появится с первым
    // документом, который заведёт агент.
    return
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) await collect(abs, root, out)
    else if (entry.isFile() && entry.name.endsWith('.d2')) out.push(toPosix(relative(root, abs)))
  }
}

export async function listDocuments(root: string, docsDir = DEFAULT_DOCS_DIR): Promise<LogicDocument[]> {
  const paths: string[] = []
  await collect(join(root, docsDir), root, paths)
  paths.sort()

  const docs: LogicDocument[] = []
  for (const path of paths) {
    // Файлы на подчёркивание это не документы, а подключаемые куски вроде
    // палитры: в списке им делать нечего.
    if ((path.split('/').pop() ?? '').startsWith('_')) continue
    const source = await readFile(join(root, path), 'utf8')
    docs.push(parseDocument(path, source))
  }
  return docs
}

/**
 * Файлы каталога под теми именами, которыми их видит импорт внутри документа.
 * D2 ищет `...@_palette` как `_palette.d2` рядом с собой, поэтому ключом идёт
 * имя файла, а не путь от корня проекта.
 */
export async function neighbourFiles(root: string, docsDir = DEFAULT_DOCS_DIR): Promise<Record<string, string>> {
  const paths: string[] = []
  await collect(join(root, docsDir), root, paths)

  const files: Record<string, string> = {}
  for (const path of paths) {
    const name = path.split('/').pop()
    if (!name) continue
    files[name] = await readFile(join(root, path), 'utf8')
  }
  return files
}

/**
 * Сверяет якоря документа со структурным графом. Документ, чьи якоря указывают
 * на исчезнувший код, описывает поведение, которого больше нет.
 */
export function checkAnchors(db: DatabaseSync, doc: LogicDocument): BrokenAnchor[] {
  const broken: BrokenAnchor[] = []
  const fileStmt = db.prepare('SELECT count(*) AS n FROM files WHERE path = ?')

  for (const anchor of doc.anchors) {
    const file = fileStmt.get(anchor.file) as { n: number }
    if (file.n === 0) {
      broken.push({ ...anchor, reason: 'file-missing' })
      continue
    }

    const current = currentHash(db, anchor)
    if (anchor.symbol && current === null) {
      broken.push({ ...anchor, reason: 'symbol-missing' })
      continue
    }

    // Без отпечатка сверять не с чем, и это не повод ругаться: документ просто
    // ещё ни разу не сверяли.
    if (anchor.fingerprint && current !== null && current !== anchor.fingerprint) {
      broken.push({ ...anchor, reason: 'drifted' })
    }
  }
  return broken
}

/** Хеш кода под якорем прямо сейчас. null, если такого символа в карте нет. */
function currentHash(db: DatabaseSync, anchor: DocAnchor): string | null {
  const stmt = db.prepare(
    `SELECT n.body_hash AS hash FROM anchors a
     JOIN nodes n ON n.id = a.node_id
     WHERE a.file = ? AND a.symbol = ? AND n.status <> 'removed'
     LIMIT 1`,
  )
  const row = stmt.get(anchor.file, anchor.symbol) as { hash: string | null } | undefined
  if (!row) return null
  return row.hash
}

/**
 * Проставляет документу отпечатки по текущему коду. Это заявление человека или
 * агента: я сверил, сейчас документ описывает то, что в коде. Дальше любая
 * правка под якорем сделает расхождение видимым.
 */
export function sealAnchors(db: DatabaseSync, doc: LogicDocument, by: CheckedBy = 'agent'): LogicDocument {
  return {
    ...doc,
    // Запись о том, кто сверял, и есть весь смысл отметки. Без неё документ,
    // который агент и написал, и сам объявил верным, выглядит так же, как
    // прочитанный человеком.
    checked: { by, on: new Date().toISOString().slice(0, 10) },
    anchors: doc.anchors.map((a) => ({ ...a, fingerprint: currentHash(db, a) ?? '' })),
  }
}

/**
 * Статус, каким его видит читатель.
 *
 * В файле лежит заявление человека, а не факт. Заявление перестаёт
 * действовать, когда код под якорем переписали: подтверждали одно, в
 * репозитории другое. Поэтому подтверждённый разошедшийся документ показывается
 * устаревшим, а в файле остаётся то, что человек написал: переписывать чужое
 * заявление за него мы не вправе.
 */
export function shownStatus(doc: LogicDocument, broken: BrokenAnchor[]): DocStatus {
  if (broken.length === 0) return doc.status
  return doc.status === 'approved' ? 'outdated' : doc.status
}

export async function checkLibrary(
  db: DatabaseSync,
  root: string,
  docsDir = DEFAULT_DOCS_DIR,
): Promise<CheckedDocument[]> {
  const docs = await listDocuments(root, docsDir)
  return docs.map((doc) => ({ ...doc, broken: checkAnchors(db, doc) }))
}
