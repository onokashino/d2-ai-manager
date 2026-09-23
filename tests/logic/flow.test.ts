import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, cpSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProject } from '../../src/scan/pipeline.js'
import type { DatabaseSync } from 'node:sqlite'
import { openDb, closeDb } from '../../src/store/db.js'
import { parseFlow, formatFlow, checkFlow, traceCalls } from '../../src/logic/flow.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

async function scanned(): Promise<{ db: DatabaseSync; root: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-flow-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  const dbPath = join(dir, 'graph.sqlite')
  await scanProject({ root, dbPath })
  return { db: openDb(dbPath), root }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('parseFlow', () => {
  it('reads a chain of steps', () => {
    expect(parseFlow('src/a.ts:one -> src/b.ts:two')).toEqual([
      { file: 'src/a.ts', symbol: 'one' },
      { file: 'src/b.ts', symbol: 'two' },
    ])
  })

  it('drops a step without a symbol', () => {
    // Ход идёт через функции: шаг на файл целиком не с чем связывать, и
    // молчаливо принять его значило бы обещать проверку, которой нет.
    expect(parseFlow('src/a.ts -> src/b.ts:two')).toEqual([{ file: 'src/b.ts', symbol: 'two' }])
  })

  it('normalises windows separators', () => {
    expect(parseFlow('src\\a.ts:one')).toEqual([{ file: 'src/a.ts', symbol: 'one' }])
  })

  it('round trips through formatFlow', () => {
    const text = 'src/a.ts:one -> src/b.ts:two'
    expect(formatFlow(parseFlow(text))).toBe(text)
  })
})

describe('checkFlow', () => {
  it('stays quiet while every step and every hop is in place', async () => {
    const { db } = await scanned()
    const issues = checkFlow(
      db,
      parseFlow('src/index.ts:main -> src/auth/token.ts:verifyToken -> src/auth/token.ts:TokenService'),
    )
    closeDb(db)
    expect(issues).toEqual([])
  })

  it('reports a step that is no longer in the map', async () => {
    const { db } = await scanned()
    const issues = checkFlow(db, parseFlow('src/index.ts:main -> src/auth/token.ts:gone'))
    closeDb(db)
    expect(issues).toEqual([{ kind: 'step-missing', step: { file: 'src/auth/token.ts', symbol: 'gone' } }])
  })

  it('reports a hop that does not exist between two real steps', async () => {
    const { db } = await scanned()
    // Обе функции на месте, но main зовёт touchSession не напрямую. Якоря
    // такого не видят вовсе: по отдельности обе точки целы.
    const issues = checkFlow(db, parseFlow('src/index.ts:main -> src/auth/session.ts:touchSession'))
    closeDb(db)
    expect(issues).toEqual([
      {
        kind: 'link-missing',
        from: { file: 'src/index.ts', symbol: 'main' },
        to: { file: 'src/auth/session.ts', symbol: 'touchSession' },
      },
    ])
  })

  it('says nothing about a hop between steps it already called missing', async () => {
    const { db } = await scanned()
    const issues = checkFlow(db, parseFlow('src/a.ts:gone -> src/b.ts:alsoGone'))
    closeDb(db)
    expect(issues.map((i) => i.kind)).toEqual(['step-missing', 'step-missing'])
  })

  it('notices a hop that disappeared after the code changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimd2-flow-'))
    dirs.push(dir)
    const root = join(dir, 'project')
    cpSync(FIXTURE, root, { recursive: true })
    const dbPath = join(dir, 'graph.sqlite')
    await scanProject({ root, dbPath })

    // main перестаёт звать verifyToken, хотя обе функции остаются на месте.
    writeFileSync(
      join(root, 'src', 'index.ts'),
      "import { verifyToken } from './auth/token'\n\nexport function main(raw: string): string {\n  void verifyToken\n  return raw\n}\n",
    )
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const issues = checkFlow(db, parseFlow('src/index.ts:main -> src/auth/token.ts:verifyToken'))
    closeDb(db)
    expect(issues.map((i) => i.kind)).toEqual(['link-missing'])
  })
})

describe('traceCalls', () => {
  it('follows calls across files', async () => {
    const { db } = await scanned()
    const tree = traceCalls(db, { file: 'src/index.ts', symbol: 'main' }, 3)
    closeDb(db)
    expect(tree?.calls.map((c) => c.step.symbol)).toEqual(['verifyToken'])
    expect(tree?.calls[0]?.calls.map((c) => c.step.symbol)).toEqual(['TokenService'])
  })

  it('stops at the depth it was given', async () => {
    const { db } = await scanned()
    const tree = traceCalls(db, { file: 'src/index.ts', symbol: 'main' }, 1)
    closeDb(db)
    expect(tree?.calls.map((c) => c.step.symbol)).toEqual(['verifyToken'])
    expect(tree?.calls[0]?.calls).toEqual([])
  })

  it('returns nothing for a symbol the map does not know', async () => {
    const { db } = await scanned()
    const tree = traceCalls(db, { file: 'src/index.ts', symbol: 'nowhere' }, 3)
    closeDb(db)
    expect(tree).toBeNull()
  })
})
