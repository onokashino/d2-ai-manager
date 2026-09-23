import type { DatabaseSync } from 'node:sqlite'
import type { Anchor, GraphNode, NodeStatus } from '../graph/types.js'
import { inSavepoint } from './tx.js'

export type UpsertResult = 'created' | 'updated' | 'unchanged' | 'protected'

const SEP = '\u0000'

interface NodeRow {
  id: string
  kind: string
  layer: string
  title: string
  summary: string | null
  status: string
  source: string
  confidence: number
  cluster_id: string | null
  symbol_kind: string | null
  body_hash: string | null
}

interface AnchorRow {
  file: string
  symbol: string
  start_line: number
  end_line: number
  commit_sha: string | null
}

function readAnchors(db: DatabaseSync, nodeId: string): Anchor[] {
  const stmt = db.prepare(
    'SELECT file, symbol, start_line, end_line, commit_sha FROM anchors WHERE node_id = ? ORDER BY file, symbol',
  )
  // node:sqlite's .all() returns Record<string, SQLOutputValue>[]; tsc rejects a direct
  // cast to a named interface array as "insufficient overlap" even though the shape
  // matches at runtime, so we go through unknown as tsc itself suggests.
  const rows = stmt.all(nodeId) as unknown as AnchorRow[]
  return rows.map((r) => ({
    file: r.file,
    symbol: r.symbol,
    startLine: r.start_line,
    endLine: r.end_line,
    commit: r.commit_sha,
  }))
}

function writeAnchors(db: DatabaseSync, nodeId: string, anchors: Anchor[]): void {
  const del = db.prepare('DELETE FROM anchors WHERE node_id = ?')
  del.run(nodeId)
  const ins = db.prepare(
    'INSERT INTO anchors (node_id, file, symbol, start_line, end_line, commit_sha) VALUES (?, ?, ?, ?, ?, ?)',
  )
  for (const a of anchors) ins.run(nodeId, a.file, a.symbol, a.startLine, a.endLine, a.commit)
}

function recordRevision(
  db: DatabaseSync,
  nodeId: string,
  sessionId: string,
  change: string,
  before: unknown,
  after: unknown,
): void {
  const stmt = db.prepare(
    'INSERT INTO revisions (node_id, session_id, changed_at, change, before, after) VALUES (?, ?, ?, ?, ?, ?)',
  )
  stmt.run(
    nodeId,
    sessionId,
    Date.now(),
    change,
    before === null ? null : JSON.stringify(before),
    after === null ? null : JSON.stringify(after),
  )
}

// Снимок для ревизии. Переезд узла из parser в model это центральное событие
// следующего этапа, и без этих полей такая ревизия имела бы одинаковые before
// и after, то есть запись без информации об изменении.
function snapshot(node: GraphNode): Record<string, unknown> {
  return {
    title: node.title,
    summary: node.summary,
    status: node.status,
    kind: node.kind,
    layer: node.layer,
    source: node.source,
    confidence: node.confidence,
    clusterId: node.clusterId,
    symbolKind: node.symbolKind,
    bodyHash: node.bodyHash,
    anchors: node.anchors,
  }
}

function sameAnchors(a: Anchor[], b: Anchor[]): boolean {
  // Поля склеиваются нулевым байтом, а не '#': '#' встречается и в путях, и в
  // именах символов. commit входит в ключ, иначе смена коммита при тех же
  // строках осталась бы незамеченной и commit_sha в таблице протух бы молча.
  const key = (xs: Anchor[]) =>
    xs
      .map((x) => [x.file, x.symbol, x.startLine, x.endLine, x.commit ?? ''].join(SEP))
      .sort()
      .join(SEP)
  return key(a) === key(b)
}

/**
 * Узел символа по файлу и пути символа.
 *
 * Null и когда символа нет, и когда их несколько: класс с интерфейсом одного
 * имени в одном файле неразличимы по этим двум полям, а ребро, проведённое
 * наугад, дороже отсутствующего. По ложной связи документ объявят
 * разошедшимся там, где ничего не менялось, и читать предупреждения перестанут
 * вообще.
 */
export function findSymbolNode(db: DatabaseSync, file: string, symbol: string): string | null {
  const rows = db
    .prepare(
      `SELECT a.node_id AS id FROM anchors a JOIN nodes n ON n.id = a.node_id
       WHERE a.file = ? AND a.symbol = ? AND n.kind = 'symbol' AND n.status <> 'removed'`,
    )
    .all(file, symbol) as { id: string }[]
  return rows.length === 1 ? rows[0]!.id : null
}

export function getNode(db: DatabaseSync, id: string): GraphNode | null {
  const stmt = db.prepare(
    `SELECT id, kind, layer, title, summary, status, source, confidence, cluster_id, symbol_kind, body_hash
     FROM nodes WHERE id = ?`,
  )
  const row = stmt.get(id) as NodeRow | undefined
  if (!row) return null
  return {
    id: row.id,
    kind: row.kind as GraphNode['kind'],
    layer: row.layer as GraphNode['layer'],
    title: row.title,
    summary: row.summary,
    status: row.status as NodeStatus,
    source: row.source as GraphNode['source'],
    confidence: row.confidence,
    clusterId: row.cluster_id,
    symbolKind: row.symbol_kind,
    bodyHash: row.body_hash,
    anchors: readAnchors(db, id),
  }
}

export function upsertNode(db: DatabaseSync, node: GraphNode, sessionId: string): UpsertResult {
  const existing = getNode(db, node.id)
  const now = Date.now()

  if (!existing) {
    return inSavepoint(db, 'upsert_node', () => {
      const stmt = db.prepare(
        `INSERT INTO nodes (id, kind, layer, title, summary, status, source, confidence, cluster_id,
                            symbol_kind, body_hash, created_session, updated_session, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      stmt.run(
        node.id, node.kind, node.layer, node.title, node.summary, node.status, node.source,
        node.confidence, node.clusterId, node.symbolKind, node.bodyHash, sessionId, sessionId, now, now,
      )
      writeAnchors(db, node.id, node.anchors)
      recordRevision(db, node.id, sessionId, 'created', null, snapshot(node))
      return 'created' as const
    })
  }

  // Ручная правка сильнее любой автоматики, это правило спеки, раздел 7.
  if (existing.source === 'human' && node.source !== 'human') return 'protected'

  const fieldsChanged =
    existing.kind !== node.kind ||
    existing.layer !== node.layer ||
    existing.title !== node.title ||
    existing.summary !== node.summary ||
    existing.status !== node.status ||
    existing.source !== node.source ||
    existing.confidence !== node.confidence ||
    existing.clusterId !== node.clusterId ||
    existing.symbolKind !== node.symbolKind ||
    existing.bodyHash !== node.bodyHash
  const anchorsChanged = !sameAnchors(existing.anchors, node.anchors)

  if (!fieldsChanged && !anchorsChanged) return 'unchanged'

  return inSavepoint(db, 'upsert_node', () => {
    const stmt = db.prepare(
      `UPDATE nodes SET kind = ?, layer = ?, title = ?, summary = ?, status = ?, source = ?,
                        confidence = ?, cluster_id = ?, symbol_kind = ?, body_hash = ?,
                        updated_session = ?, updated_at = ?
       WHERE id = ?`,
    )
    stmt.run(
      node.kind, node.layer, node.title, node.summary, node.status, node.source,
      node.confidence, node.clusterId, node.symbolKind, node.bodyHash, sessionId, now, node.id,
    )
    if (anchorsChanged) writeAnchors(db, node.id, node.anchors)
    recordRevision(db, node.id, sessionId, 'updated', snapshot(existing), snapshot(node))
    return 'updated' as const
  })
}

export function markNodesRemoved(db: DatabaseSync, ids: string[], sessionId: string): number {
  let count = 0
  const stmt = db.prepare("UPDATE nodes SET status = 'removed', updated_session = ?, updated_at = ? WHERE id = ? AND status <> 'removed'")
  for (const id of ids) {
    const before = getNode(db, id)
    if (!before || before.status === 'removed') continue
    // То же правило спеки, раздел 7, что и в upsertNode: ручной узел автоматика
    // не трогает. Сюда приходят все узлы изменённого файла, так что без этой
    // проверки первый же скан похоронил бы всё, что человек создал руками.
    if (before.source === 'human') continue
    // Та же пара операторов, что и в upsertNode: статус и ревизия фиксируются
    // вместе, иначе узел уедет в removed без записи в историю.
    inSavepoint(db, 'mark_removed', () => {
      stmt.run(sessionId, Date.now(), id)
      recordRevision(db, id, sessionId, 'removed', { status: before.status }, { status: 'removed' })
    })
    count += 1
  }
  return count
}

export function listRevisions(db: DatabaseSync, nodeId: string): { change: string; sessionId: string }[] {
  const stmt = db.prepare('SELECT change, session_id FROM revisions WHERE node_id = ? ORDER BY id')
  const rows = stmt.all(nodeId) as { change: string; session_id: string }[]
  return rows.map((r) => ({ change: r.change, sessionId: r.session_id }))
}
