import type { DatabaseSync } from 'node:sqlite'
import { toPosix } from '../graph/ids.js'

export interface ViewerNode {
  id: string
  kind: string
  layer: string
  title: string
  status: string
  source: string
  symbolKind: string | null
  file: string | null
  startLine: number | null
  endLine: number | null
}

export interface ViewerEdge {
  from: string
  to: string
  kind: string
}

export interface ViewerGraph {
  nodes: ViewerNode[]
  edges: ViewerEdge[]
  sessions: { id: string; agent: string; startedAt: number; changed: number }[]
  root: string
}

interface NodeRow {
  id: string
  kind: string
  layer: string
  title: string
  status: string
  source: string
  symbol_kind: string | null
  file: string | null
  start_line: number | null
  end_line: number | null
}

export function readGraph(db: DatabaseSync, root: string): ViewerGraph {
  // Якорь присоединяется слева: у модульного узла он есть всегда, но у узла,
  // потерявшего код, его может не быть, и такой узел всё равно нужно показать.
  const nodes = db
    .prepare(
      `SELECT n.id, n.kind, n.layer, n.title, n.status, n.source, n.symbol_kind,
              a.file, a.start_line, a.end_line
       FROM nodes n
       LEFT JOIN anchors a ON a.node_id = n.id
       ORDER BY n.kind, n.title`,
    )
    .all() as unknown as NodeRow[]

  const edges = db.prepare('SELECT from_id, to_id, kind FROM edges').all() as {
    from_id: string
    to_id: string
    kind: string
  }[]

  const sessions = db
    .prepare(
      `SELECT s.id, s.agent, s.started_at,
              (SELECT count(*) FROM revisions r WHERE r.session_id = s.id) AS changed
       FROM sessions s
       ORDER BY s.started_at DESC`,
    )
    .all() as { id: string; agent: string; started_at: number; changed: number }[]

  return {
    root: toPosix(root),
    nodes: nodes.map((r) => ({
      id: r.id,
      kind: r.kind,
      layer: r.layer,
      title: r.title,
      status: r.status,
      source: r.source,
      symbolKind: r.symbol_kind,
      file: r.file,
      startLine: r.start_line,
      endLine: r.end_line,
    })),
    edges: edges.map((e) => ({ from: e.from_id, to: e.to_id, kind: e.kind })),
    sessions: sessions.map((s) => ({
      id: s.id,
      agent: s.agent,
      startedAt: s.started_at,
      changed: s.changed,
    })),
  }
}
