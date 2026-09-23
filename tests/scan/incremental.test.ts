import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, closeDb } from '../../src/store/db.js'
import { startSession } from '../../src/store/sessions.js'
import { upsertNode } from '../../src/store/nodes.js'
import { diffFiles, recordFiles, forgetFiles, nodeIdsForFiles } from '../../src/scan/incremental.js'
import type { FileState } from '../../src/scan/incremental.js'

let db: DatabaseSync

const f = (path: string, hash: string): FileState => ({ path, hash, language: 'typescript', size: 10 })

beforeEach(() => { db = openDb(':memory:') })
afterEach(() => closeDb(db))

describe('diffFiles', () => {
  it('treats everything as changed on the first run', () => {
    const delta = diffFiles(db, [f('a.ts', 'h1'), f('b.ts', 'h2')])
    expect(delta.changed.sort()).toEqual(['a.ts', 'b.ts'])
    expect(delta.removed).toEqual([])
    expect(delta.unchanged).toEqual([])
  })

  it('detects unchanged, changed and removed files', () => {
    recordFiles(db, [f('a.ts', 'h1'), f('b.ts', 'h2'), f('c.ts', 'h3')])
    const delta = diffFiles(db, [f('a.ts', 'h1'), f('b.ts', 'CHANGED')])
    expect(delta.unchanged).toEqual(['a.ts'])
    expect(delta.changed).toEqual(['b.ts'])
    expect(delta.removed).toEqual(['c.ts'])
  })

  it('reports every known file as removed when the current list is empty', () => {
    recordFiles(db, [f('a.ts', 'h1'), f('b.ts', 'h2')])
    const delta = diffFiles(db, [])
    expect(delta.removed).toEqual(['a.ts', 'b.ts'])
    expect(delta.changed).toEqual([])
  })
})

describe('nodeIdsForFiles', () => {
  it('returns ids of nodes anchored in the given files', () => {
    const session = startSession(db, { agent: 'test' })
    upsertNode(db, {
      id: 'n1', kind: 'symbol', layer: 'structure', title: 't', summary: null,
      status: 'implemented', source: 'parser', confidence: 1, clusterId: null, symbolKind: null, bodyHash: null,
      anchors: [{ file: 'a.ts', symbol: 'x', startLine: 1, endLine: 2, commit: null }],
    }, session)
    upsertNode(db, {
      id: 'n2', kind: 'symbol', layer: 'structure', title: 't2', summary: null,
      status: 'implemented', source: 'parser', confidence: 1, clusterId: null, symbolKind: null, bodyHash: null,
      anchors: [{ file: 'b.ts', symbol: 'y', startLine: 1, endLine: 2, commit: null }],
    }, session)
    expect(nodeIdsForFiles(db, ['a.ts'])).toEqual(['n1'])
  })
})

describe('nodeIdsForFiles, large batches', () => {
  it('survives more paths than sqlite accepts parameters in one query', () => {
    const session = startSession(db, { agent: 'test' })
    upsertNode(db, {
      id: 'n1', kind: 'symbol', layer: 'structure', title: 't', summary: null,
      status: 'implemented', source: 'parser', confidence: 1, clusterId: null, symbolKind: null, bodyHash: null,
      anchors: [{ file: 'deep/target.ts', symbol: 'x', startLine: 1, endLine: 2, commit: null }],
    }, session)

    const many = Array.from({ length: 40000 }, (_, i) => `generated/file-${i}.ts`)
    many.push('deep/target.ts')
    expect(nodeIdsForFiles(db, many)).toEqual(['n1'])
  })
})

describe('forgetFiles', () => {
  it('drops file rows so the next scan sees them as new', () => {
    recordFiles(db, [f('a.ts', 'h1')])
    forgetFiles(db, ['a.ts'])
    expect(diffFiles(db, [f('a.ts', 'h1')]).changed).toEqual(['a.ts'])
  })
})
