import type { DatabaseSync } from 'node:sqlite'
import { inSavepoint } from '../store/tx.js'

export interface FileState {
  path: string
  hash: string
  language: string
  size: number
}

export interface ScanDelta {
  changed: string[]
  /**
   * Пути, пропавшие из проекта. Вызывающий обязан вызвать forgetFiles для
   * каждого из них. Иначе вернувшийся позже файл с тем же содержимым будет
   * признан unchanged, повторно не разберётся, и его узлы навсегда останутся
   * в статусе removed.
   */
  removed: string[]
  unchanged: string[]
}

// sqlite ограничивает число параметров запроса, на сборке этого проекта
// потолок 32766. Берём с запасом, чтобы удаление большого каталога не роняло скан.
const MAX_SQL_VARIABLES = 900

/**
 * Совпадает ли записанная версия правил разбора с текущей, и записывает текущую.
 *
 * Несовпадение означает, что кеш файлов верить нельзя: содержимое не менялось,
 * а извлекать из него теперь надо другое.
 */
export function extractorMatches(db: DatabaseSync, version: number): boolean {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'extractor_version'").get() as
    | { value: string }
    | undefined
  const same = row?.value === String(version)
  if (!same) {
    db.prepare("INSERT INTO meta (key, value) VALUES ('extractor_version', ?) " +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(String(version))
  }
  return same
}

export function diffFiles(db: DatabaseSync, current: FileState[]): ScanDelta {
  const stmt = db.prepare('SELECT path, hash FROM files')
  const rows = stmt.all() as { path: string; hash: string }[]

  const known = new Map(rows.map((r) => [r.path, r.hash]))
  const seen = new Set<string>()
  const changed: string[] = []
  const unchanged: string[] = []

  for (const file of current) {
    seen.add(file.path)
    if (known.get(file.path) === file.hash) unchanged.push(file.path)
    else changed.push(file.path)
  }

  const removed = [...known.keys()].filter((p) => !seen.has(p))
  return { changed: changed.sort(), removed: removed.sort(), unchanged: unchanged.sort() }
}

export function recordFiles(db: DatabaseSync, files: FileState[]): void {
  // Одна транзакция на всю партию: в режиме WAL каждый незавёрнутый оператор
  // это отдельный коммит, а смысл этого модуля в том, чтобы повторный скан
  // был дешёвым.
  inSavepoint(db, 'record_files', () => {
    const stmt = db.prepare(
      `INSERT INTO files (path, hash, language, size, scanned_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET hash = excluded.hash, language = excluded.language,
                                       size = excluded.size, scanned_at = excluded.scanned_at`,
    )
    const now = Date.now()
    for (const f of files) stmt.run(f.path, f.hash, f.language, f.size, now)
  })
}

/**
 * Убирает записи о файлах, чтобы следующий скан увидел их как новые.
 * Вызывается для каждого пути из ScanDelta.removed, см. комментарий там.
 */
export function forgetFiles(db: DatabaseSync, paths: string[]): void {
  inSavepoint(db, 'forget_files', () => {
    const stmt = db.prepare('DELETE FROM files WHERE path = ?')
    for (const p of paths) stmt.run(p)
  })
}

export function nodeIdsForFiles(db: DatabaseSync, paths: string[]): string[] {
  if (paths.length === 0) return []

  const ids = new Set<string>()
  // Запрос идёт частями: список путей приходит от вызывающего и при удалении
  // крупного каталога легко превышает лимит параметров sqlite.
  for (let start = 0; start < paths.length; start += MAX_SQL_VARIABLES) {
    const chunk = paths.slice(start, start + MAX_SQL_VARIABLES)
    const placeholders = chunk.map(() => '?').join(', ')
    const stmt = db.prepare(`SELECT DISTINCT node_id FROM anchors WHERE file IN (${placeholders})`)
    for (const row of stmt.all(...chunk) as { node_id: string }[]) ids.add(row.node_id)
  }
  return [...ids].sort()
}
