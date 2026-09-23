import type { DatabaseSync } from 'node:sqlite'

export function inSavepoint<T>(db: DatabaseSync, name: string, fn: () => T): T {
  // SAVEPOINT, а не BEGIN: вызывающий код может уже держать открытую
  // транзакцию, и вложенный BEGIN в sqlite падает.
  db.exec(`SAVEPOINT ${name}`)
  try {
    const result = fn()
    db.exec(`RELEASE ${name}`)
    return result
  } catch (error) {
    db.exec(`ROLLBACK TO ${name}`)
    db.exec(`RELEASE ${name}`)
    throw error
  }
}
