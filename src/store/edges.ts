import type { DatabaseSync } from 'node:sqlite'
import type { EdgeKind, GraphEdge, NodeSource } from '../graph/types.js'
import { inSavepoint } from './tx.js'

export function upsertEdge(db: DatabaseSync, edge: GraphEdge): 'created' | 'unchanged' {
  const check = db.prepare('SELECT 1 AS hit FROM edges WHERE from_id = ? AND to_id = ? AND kind = ?')
  const hit = check.get(edge.from, edge.to, edge.kind)
  if (hit) return 'unchanged'

  const stmt = db.prepare('INSERT INTO edges (from_id, to_id, kind, source, confidence) VALUES (?, ?, ?, ?, ?)')
  stmt.run(edge.from, edge.to, edge.kind, edge.source, edge.confidence)
  return 'created'
}

/** Возвращает число реально вставленных строк: дубликаты в списке его не увеличивают. */
export function replaceEdgesFrom(db: DatabaseSync, fromId: string, kind: EdgeKind, edges: GraphEdge[]): number {
  // Deletion and insertion go together: a failure in the loop would leave the file with no
  // edges of this kind at all, even though the old ones were correct.
  return inSavepoint(db, 'replace_edges', () => {
    const del = db.prepare('DELETE FROM edges WHERE from_id = ? AND kind = ?')
    del.run(fromId, kind)
    let written = 0
    for (const e of edges) if (upsertEdge(db, e) === 'created') written += 1
    return written
  })
}

export function listEdgesFrom(db: DatabaseSync, fromId: string): GraphEdge[] {
  const stmt = db.prepare('SELECT from_id, to_id, kind, source, confidence FROM edges WHERE from_id = ? ORDER BY to_id, kind')
  const rows = stmt.all(fromId) as { from_id: string; to_id: string; kind: string; source: string; confidence: number }[]
  return rows.map((r) => ({
    from: r.from_id,
    to: r.to_id,
    kind: r.kind as EdgeKind,
    source: r.source as NodeSource,
    confidence: r.confidence,
  }))
}
