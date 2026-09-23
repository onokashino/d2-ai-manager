import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js'

function storedVersion(db: DatabaseSync): number | null {
  // meta может не существовать: база только что создана и таблиц в ней нет.
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get()
  if (!table) return null

  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as
    | { value: string }
    | undefined
  if (!row) return null

  const parsed = Number(row.value)
  return Number.isFinite(parsed) ? parsed : null
}

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })

  const db = new DatabaseSync(path, { timeout: 5000 })
  db.exec('PRAGMA journal_mode = WAL')
  // PRAGMA foreign_keys намеренно не ставится: ни одна таблица схемы не
  // объявляет внешний ключ, а объявить их нельзя. Ребро пишется в тот же скан,
  // что и узлы, но порядок обхода файлов не гарантирует, что целевой узел уже
  // существует. Если внешние ключи когда-нибудь появятся в схеме, прагму надо
  // вернуть вместе с ними.
  const found = storedVersion(db)

  if (found === null) {
    // Новая база: таблицы и отметка версии пишутся одной транзакцией, иначе
    // сбой между ними оставил бы базу без версии или с версией без таблиц.
    try {
      db.exec('BEGIN')
      db.exec(SCHEMA_SQL)
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      db.close()
      throw error
    }
    return db
  }

  if (found !== SCHEMA_VERSION) {
    // Миграций пока нет, а CREATE TABLE IF NOT EXISTS чужую схему не исправит:
    // без этой проверки старая база молча получила бы новый ярлык версии и
    // первый же запрос к новой колонке упал бы посреди скана.
    db.close()
    throw new Error(
      `database schema version ${found} does not match the expected ${SCHEMA_VERSION}: ` +
        `no migrations exist yet, delete the database file ${path} and scan again`,
    )
  }

  return db
}

export function closeDb(db: DatabaseSync): void {
  db.close()
}
