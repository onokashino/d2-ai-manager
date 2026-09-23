import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

export function startSession(db: DatabaseSync, opts: { agent: string; model?: string }): string {
  const id = randomUUID()
  const stmt = db.prepare('INSERT INTO sessions (id, agent, model, started_at) VALUES (?, ?, ?, ?)')
  stmt.run(id, opts.agent, opts.model ?? null, Date.now())
  return id
}

export function endSession(db: DatabaseSync, sessionId: string): void {
  const stmt = db.prepare('UPDATE sessions SET ended_at = ? WHERE id = ?')
  stmt.run(Date.now(), sessionId)
}
