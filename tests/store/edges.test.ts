import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, closeDb } from '../../src/store/db.js'
import { upsertEdge, replaceEdgesFrom, listEdgesFrom } from '../../src/store/edges.js'
import type { GraphEdge } from '../../src/graph/types.js'

let db: DatabaseSync

function edge(to: string): GraphEdge {
  return { from: 'a', to, kind: 'imports', source: 'parser', confidence: 1 }
}

beforeEach(() => { db = openDb(':memory:') })
afterEach(() => closeDb(db))

describe('upsertEdge', () => {
  it('creates an edge once', () => {
    expect(upsertEdge(db, edge('b'))).toBe('created')
    expect(upsertEdge(db, edge('b'))).toBe('unchanged')
    expect(listEdgesFrom(db, 'a')).toHaveLength(1)
  })
})

describe('replaceEdgesFrom', () => {
  it('drops edges of that kind that are no longer present', () => {
    upsertEdge(db, edge('b'))
    upsertEdge(db, edge('c'))
    replaceEdgesFrom(db, 'a', 'imports', [edge('c')])
    expect(listEdgesFrom(db, 'a').map((e) => e.to)).toEqual(['c'])
  })

  it('leaves edges of other kinds untouched', () => {
    upsertEdge(db, { from: 'a', to: 'b', kind: 'calls', source: 'parser', confidence: 1 })
    replaceEdgesFrom(db, 'a', 'imports', [])
    expect(listEdgesFrom(db, 'a').map((e) => e.kind)).toEqual(['calls'])
  })

  it('returns the number of rows it actually inserted', () => {
    expect(replaceEdgesFrom(db, 'a', 'imports', [edge('b'), edge('b'), edge('c')])).toBe(2)
    expect(listEdgesFrom(db, 'a').map((e) => e.to)).toEqual(['b', 'c'])
  })

  it('keeps the old edges when an insert fails midway', () => {
    upsertEdge(db, edge('b'))
    // Trigger models an insert failure: without a shared rollback point, the file would have
    // no edges of this kind at all, even though the old ones were correct.
    db.exec("CREATE TRIGGER fail_edges BEFORE INSERT ON edges BEGIN SELECT RAISE(ABORT, 'boom'); END")
    expect(() => replaceEdgesFrom(db, 'a', 'imports', [edge('c')])).toThrow()
    db.exec('DROP TRIGGER fail_edges')
    expect(listEdgesFrom(db, 'a').map((e) => e.to)).toEqual(['b'])
  })
})
