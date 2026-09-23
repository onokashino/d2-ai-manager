import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, closeDb } from '../../src/store/db.js'
import { startSession } from '../../src/store/sessions.js'
import { upsertNode, getNode, markNodesRemoved, listRevisions } from '../../src/store/nodes.js'
import type { GraphNode } from '../../src/graph/types.js'

let db: DatabaseSync
let session: string

function node(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    kind: 'symbol',
    layer: 'structure',
    title: 'verifyToken',
    summary: null,
    status: 'implemented',
    source: 'parser',
    confidence: 1,
    clusterId: null,
    symbolKind: null,
    bodyHash: null,
    anchors: [{ file: 'src/auth/token.ts', symbol: 'verifyToken', startLine: 42, endLine: 88, commit: null }],
    ...over,
  }
}

beforeEach(() => {
  db = openDb(':memory:')
  session = startSession(db, { agent: 'test' })
})

afterEach(() => closeDb(db))

describe('upsertNode', () => {
  it('creates a node and records a revision', () => {
    expect(upsertNode(db, node(), session)).toBe('created')
    expect(getNode(db, 'n1')?.title).toBe('verifyToken')
    expect(listRevisions(db, 'n1').map((r) => r.change)).toEqual(['created'])
  })

  it('reports unchanged when nothing differs', () => {
    upsertNode(db, node(), session)
    expect(upsertNode(db, node(), session)).toBe('unchanged')
    expect(listRevisions(db, 'n1')).toHaveLength(1)
  })

  it('updates and records a revision when a field changes', () => {
    upsertNode(db, node(), session)
    expect(upsertNode(db, node({ summary: 'проверяет подпись' }), session)).toBe('updated')
    expect(getNode(db, 'n1')?.summary).toBe('проверяет подпись')
    expect(listRevisions(db, 'n1').map((r) => r.change)).toEqual(['created', 'updated'])
  })

  it('records new anchor lines as an update', () => {
    upsertNode(db, node(), session)
    const moved = node({ anchors: [{ file: 'src/auth/token.ts', symbol: 'verifyToken', startLine: 142, endLine: 188, commit: null }] })
    expect(upsertNode(db, moved, session)).toBe('updated')
    expect(getNode(db, 'n1')?.anchors[0]?.startLine).toBe(142)
  })

  it('writes a revision whose before and after differ when only the source changed', () => {
    upsertNode(db, node(), session)
    expect(upsertNode(db, node({ source: 'model' }), session)).toBe('updated')
    const rows = db
      .prepare("SELECT before, after FROM revisions WHERE node_id = 'n1' AND change = 'updated'")
      .all() as unknown as { before: string; after: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.before).not.toBe(rows[0]!.after)
    expect(JSON.parse(rows[0]!.before).source).toBe('parser')
    expect(JSON.parse(rows[0]!.after).source).toBe('model')
  })

  it('refuses to let the parser overwrite a human node', () => {
    upsertNode(db, node({ source: 'human', title: 'ручное имя' }), session)
    expect(upsertNode(db, node({ source: 'parser', title: 'verifyToken' }), session)).toBe('protected')
    expect(getNode(db, 'n1')?.title).toBe('ручное имя')
  })

  it('writes a revision whose before and after differ when only anchors moved', () => {
    upsertNode(db, node(), session)
    const moved = node({ anchors: [{ file: 'src/auth/token.ts', symbol: 'verifyToken', startLine: 142, endLine: 188, commit: null }] })
    upsertNode(db, moved, session)
    const rows = db.prepare("SELECT before, after FROM revisions WHERE node_id = 'n1' AND change = 'updated'").all() as { before: string; after: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.before).not.toBe(rows[0]!.after)
  })

  it('detects a commit change even when the lines are identical', () => {
    upsertNode(db, node(), session)
    const recommitted = node({ anchors: [{ file: 'src/auth/token.ts', symbol: 'verifyToken', startLine: 42, endLine: 88, commit: 'abc1234' }] })
    expect(upsertNode(db, recommitted, session)).toBe('updated')
    expect(getNode(db, 'n1')?.anchors[0]?.commit).toBe('abc1234')
  })

  it('rolls the whole write back when the anchors violate their primary key', () => {
    const broken = node({
      anchors: [
        { file: 'a.ts', symbol: 'x', startLine: 1, endLine: 2, commit: null },
        { file: 'a.ts', symbol: 'x', startLine: 9, endLine: 9, commit: null },
      ],
    })
    expect(() => upsertNode(db, broken, session)).toThrow()
    expect(getNode(db, 'n1')).toBeNull()
    expect(listRevisions(db, 'n1')).toHaveLength(0)
  })

  it('protects a human node from a model as well as from the parser', () => {
    upsertNode(db, node({ source: 'human', title: 'ручное имя' }), session)
    expect(upsertNode(db, node({ source: 'model', title: 'из модели' }), session)).toBe('protected')
    expect(getNode(db, 'n1')?.title).toBe('ручное имя')
  })
})

describe('markNodesRemoved', () => {
  it('sets status removed and records a revision instead of deleting', () => {
    upsertNode(db, node(), session)
    expect(markNodesRemoved(db, ['n1'], session)).toBe(1)
    expect(getNode(db, 'n1')?.status).toBe('removed')
    expect(listRevisions(db, 'n1').map((r) => r.change)).toEqual(['created', 'removed'])
  })

  it('does not re-mark an already removed node', () => {
    upsertNode(db, node(), session)
    markNodesRemoved(db, ['n1'], session)
    expect(markNodesRemoved(db, ['n1'], session)).toBe(0)
    expect(listRevisions(db, 'n1')).toHaveLength(2)
  })

  it('keeps the status unchanged when the revision insert fails', () => {
    upsertNode(db, node(), session)
    // Триггер даёт детерминированный сбой на вставке ревизии: в реальности так
    // проявляются SQLITE_BUSY и переполнение диска, которые в тесте не создать.
    db.exec("CREATE TRIGGER fail_revisions BEFORE INSERT ON revisions BEGIN SELECT RAISE(ABORT, 'boom'); END")
    expect(() => markNodesRemoved(db, ['n1'], session)).toThrow()
    db.exec('DROP TRIGGER fail_revisions')
    expect(getNode(db, 'n1')?.status).toBe('implemented')
  })

  it('leaves a human node alone and does not count it', () => {
    upsertNode(db, node({ source: 'human', title: 'ручное имя' }), session)
    upsertNode(db, node({ id: 'n2' }), session)
    expect(markNodesRemoved(db, ['n1', 'n2'], session)).toBe(1)
    expect(getNode(db, 'n1')?.status).toBe('implemented')
    expect(getNode(db, 'n2')?.status).toBe('removed')
    expect(listRevisions(db, 'n1').map((r) => r.change)).toEqual(['created'])
  })
})
