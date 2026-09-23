import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, closeDb } from '../../src/store/db.js'
import { SCHEMA_VERSION } from '../../src/store/schema.js'

const dirs: string[] = []

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-'))
  dirs.push(dir)
  return join(dir, 'graph.sqlite')
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('openDb', () => {
  it('creates every expected table', () => {
    const db = openDb(tempDbPath())
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    const names = rows.map((r) => r.name)
    for (const t of ['meta', 'sessions', 'nodes', 'anchors', 'edges', 'revisions', 'files', 'diagrams']) {
      expect(names).toContain(t)
    }
    closeDb(db)
  })

  it('records the schema version', () => {
    const db = openDb(tempDbPath())
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }
    expect(Number(row.value)).toBe(SCHEMA_VERSION)
    closeDb(db)
  })

  it('enables write ahead logging', () => {
    const db = openDb(tempDbPath())
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(row.journal_mode.toLowerCase()).toBe('wal')
    closeDb(db)
  })

  it('is idempotent when opened twice', () => {
    const path = tempDbPath()
    const first = openDb(path)
    closeDb(first)
    const second = openDb(path)
    const row = second.prepare("SELECT count(*) AS n FROM meta WHERE key = 'schema_version'").get() as { n: number }
    expect(row.n).toBe(1)
    closeDb(second)
  })
})

describe('schema version', () => {
  it('creates and stamps a database that has no version yet', () => {
    const path = tempDbPath()
    const db = openDb(path)
    const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as unknown as {
      value: string
    }
    const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as unknown as {
      n: number
    }
    closeDb(db)
    expect(Number(row.value)).toBe(SCHEMA_VERSION)
    expect(tables.n).toBeGreaterThan(0)
  })

  it('reopens a database whose version matches and keeps its rows', () => {
    const path = tempDbPath()
    const first = openDb(path)
    first.prepare("INSERT INTO meta (key, value) VALUES ('probe', 'kept')").run()
    closeDb(first)

    const second = openDb(path)
    const row = second.prepare("SELECT value FROM meta WHERE key = 'probe'").get() as unknown as { value: string }
    closeDb(second)
    expect(row.value).toBe('kept')
  })

  it('refuses a database written by a different schema version', () => {
    const path = tempDbPath()
    const first = openDb(path)
    first.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run()
    closeDb(first)

    expect(() => openDb(path)).toThrow(/999/)
    expect(() => openDb(path)).toThrow(new RegExp(String(SCHEMA_VERSION)))
    expect(() => openDb(path)).toThrow(/delete/i)
  })
})
