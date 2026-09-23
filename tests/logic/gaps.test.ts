import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProject } from '../../src/scan/pipeline.js'
import { openDb, closeDb } from '../../src/store/db.js'
import { findGaps } from '../../src/logic/gaps.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

function workspace(doc?: string): { root: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-gaps-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })

  mkdirSync(join(root, 'docs', 'logic'), { recursive: true })
  if (doc !== undefined) writeFileSync(join(root, 'docs', 'logic', 'a.d2'), doc, 'utf8')
  return { root, dbPath: join(dir, 'graph.sqlite') }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('findGaps', () => {
  it('lists files no document looks at', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const gaps = await findGaps(db, root)
    closeDb(db)

    expect(gaps.map((g) => g.file)).toContain('src/auth/token.ts')
  })

  it('leaves out a file a document already anchors', async () => {
    const { root, dbPath } = workspace('# title: X\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n')
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const gaps = await findGaps(db, root)
    closeDb(db)

    // Якорь стоит на символе, но закрывает весь файл: документ уже смотрит
    // сюда, и предлагать завести второй про то же незачем.
    expect(gaps.map((g) => g.file)).not.toContain('src/auth/token.ts')
  })

  it('puts the files the project leans on at the top', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const gaps = await findGaps(db, root)
    closeDb(db)

    // Порядок и есть вся польза: список файлов без документа иначе просто
    // перечисляет проект целиком.
    const counts = gaps.map((g) => g.usedBy)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
  })

  it('honours the limit', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const gaps = await findGaps(db, root, 1)
    closeDb(db)

    expect(gaps).toHaveLength(1)
  })
})
