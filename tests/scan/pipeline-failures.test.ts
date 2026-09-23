import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Обход подменяется целиком: файл, пропавший между обходом и чтением, иначе не
// воспроизвести, а именно этот случай и ронял скан целиком. Мок живёт в
// отдельном файле, потому что vi.mock поднимается на весь модуль теста.
vi.mock('../../src/scan/walk.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/scan/walk.js')>()
  return {
    walkFiles: async (root: string) => [...(await actual.walkFiles(root)), 'ghost.ts'],
  }
})

const { scanProject } = await import('../../src/scan/pipeline.js')
const { openDb, closeDb } = await import('../../src/store/db.js')

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

function workspace(): { root: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-fail-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  return { root, dbPath: join(dir, 'graph.sqlite') }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('scanProject with an unreadable file', () => {
  it('finishes the scan and counts the file it could not read', async () => {
    const { root, dbPath } = workspace()
    const result = await scanProject({ root, dbPath })

    expect(result.filesFailed).toBe(1)
    expect(result.filesScanned).toBe(3)

    const db = openDb(dbPath)
    const modules = db.prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'module'").get() as unknown as {
      n: number
    }
    const files = db.prepare("SELECT count(*) AS n FROM files WHERE path = 'ghost.ts'").get() as unknown as {
      n: number
    }
    closeDb(db)
    // Остальные три файла разобраны, а призрак не попал ни в узлы, ни в files,
    // то есть следующий скан попробует его снова.
    expect(modules.n).toBe(3)
    expect(files.n).toBe(0)
  })
})
