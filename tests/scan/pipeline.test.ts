import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, cpSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProject, estimateScan } from '../../src/scan/pipeline.js'
import { openDb, closeDb } from '../../src/store/db.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

function workspace(): { root: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-scan-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  return { root, dbPath: join(dir, 'graph.sqlite') }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('estimateScan', () => {
  it('counts files by language without touching the database', async () => {
    const { root } = workspace()
    const est = await estimateScan(root)
    expect(est.files).toBe(3)
    expect(est.byLanguage.typescript).toBe(3)
  })
})

describe('scanProject', () => {
  it('creates module and symbol nodes on a cold run', async () => {
    const { root, dbPath } = workspace()
    const result = await scanProject({ root, dbPath })
    expect(result.filesScanned).toBe(3)
    expect(result.nodesCreated).toBeGreaterThan(3)

    const db = openDb(dbPath)
    const modules = db.prepare("SELECT count(*) AS n FROM nodes WHERE kind = 'module'").get() as { n: number }
    expect(modules.n).toBe(3)
    closeDb(db)
  })

  it('creates import edges between project files', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const row = db.prepare("SELECT count(*) AS n FROM edges WHERE kind = 'imports'").get() as { n: number }
    // token.ts -> session.ts и index.ts -> token.ts, больше внутрипроектных импортов в фикстуре нет
    expect(row.n).toBe(2)
    closeDb(db)
  })

  it('is a no-op on a second run with no changes', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })
    const second = await scanProject({ root, dbPath })
    expect(second.nodesCreated).toBe(0)
    expect(second.nodesUpdated).toBe(0)
    expect(second.filesScanned).toBe(0)
    // Рёбра пересоздаются при каждом разборе файла, поэтому нулевой счётчик
    // здесь единственное доказательство, что цикл разбора вообще не запускался.
    expect(second.edgesWritten).toBe(0)
  })

  it('marks nodes of a deleted file as removed without deleting them', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })
    rmSync(join(root, 'src', 'auth', 'session.ts'))
    const second = await scanProject({ root, dbPath })
    expect(second.nodesRemoved).toBeGreaterThan(0)

    const db = openDb(dbPath)
    const alive = db.prepare("SELECT count(*) AS n FROM nodes WHERE status = 'removed'").get() as { n: number }
    expect(alive.n).toBeGreaterThan(0)
    closeDb(db)
  })

  it('rescans only the changed file', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })
    writeFileSync(join(root, 'src', 'index.ts'), 'export function main(): string {\n  return "x"\n}\n')
    const second = await scanProject({ root, dbPath })
    expect(second.filesScanned).toBe(1)
  })

  it('records unknown languages as bare module nodes', async () => {
    const { root, dbPath } = workspace()
    writeFileSync(join(root, 'notes.txt'), 'plain text\n')
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const row = db.prepare("SELECT count(*) AS n FROM files WHERE language = 'unknown'").get() as { n: number }
    expect(row.n).toBe(1)
    closeDb(db)
  })

  it('marks a symbol removed when it disappears from a file that stays', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      [
        "import { touchSession } from './session'",
        '',
        'export interface User {',
        '  id: string',
        '}',
        '',
        'export class TokenService {',
        '  verify(raw: string): User {',
        '    touchSession(raw)',
        '    return { id: raw }',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
    const second = await scanProject({ root, dbPath })
    expect(second.nodesRemoved).toBeGreaterThan(0)

    const db = openDb(dbPath)
    const row = db.prepare("SELECT status FROM nodes WHERE title = 'verifyToken'").get() as { status: string }
    closeDb(db)
    expect(row.status).toBe('removed')
  })
})

describe('files of an unknown language', () => {
  it('notices a change even though the file is never read', async () => {
    const { root, dbPath } = workspace()
    writeFileSync(join(root, 'notes.txt'), 'plain text\n')
    await scanProject({ root, dbPath })

    writeFileSync(join(root, 'notes.txt'), 'plain texu\n')
    const second = await scanProject({ root, dbPath })
    expect(second.filesScanned).toBe(1)
  })

  it('hashes by stat, so touching such a file is enough to rescan it', async () => {
    const { root, dbPath } = workspace()
    const notes = join(root, 'notes.txt')
    writeFileSync(notes, 'plain text\n')
    await scanProject({ root, dbPath })

    // Содержимое то же, меняется только время правки. Для файла с известным
    // языком это ничего бы не изменило, здесь же хеш берётся из stat.
    const later = new Date(Date.now() + 60_000)
    utimesSync(notes, later, later)
    const second = await scanProject({ root, dbPath })
    expect(second.filesScanned).toBe(1)
  })

  it('does not rescan a source file whose timestamp moved but content did not', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const later = new Date(Date.now() + 60_000)
    utimesSync(join(root, 'src', 'index.ts'), later, later)
    const second = await scanProject({ root, dbPath })
    expect(second.filesScanned).toBe(0)
  })
})

describe('a failure that is not about one file', () => {
  it('keeps the reason and does not count a failed file as scanned', async () => {
    const { root, dbPath } = workspace()
    // Триггер даёт детерминированный сбой на записи узла: так в жизни
    // выглядят переполнение диска и SQLITE_BUSY, которых в тесте не создать.
    const prepared = openDb(dbPath)
    prepared.exec("CREATE TRIGGER fail_nodes BEFORE INSERT ON nodes BEGIN SELECT RAISE(ABORT, 'disk full'); END")
    closeDb(prepared)

    const result = await scanProject({ root, dbPath })

    expect(result.filesFailed).toBe(3)
    // Один и тот же файл не может быть одновременно разобран и провален.
    expect(result.filesScanned).toBe(0)
    expect(result.firstFailure?.message).toMatch(/disk full/)
    expect(result.firstFailure?.path).toBe('src/auth/session.ts')
  })
})

describe('edge counting', () => {
  it('counts one edge when a file imports the same target twice', async () => {
    const { root, dbPath } = workspace()
    writeFileSync(
      join(root, 'src', 'index.ts'),
      [
        "import { verifyToken } from './auth/token'",
        "import { TokenService } from './auth/token'",
        '',
        'export function main(raw: string): string {',
        '  return verifyToken(raw).id + String(TokenService)',
        '}',
        '',
      ].join('\n'),
    )
    const result = await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const row = db
      .prepare("SELECT count(*) AS n FROM edges WHERE kind = 'imports'")
      .get() as unknown as { n: number }
    const all = db.prepare('SELECT count(*) AS n FROM edges').get() as unknown as { n: number }
    closeDb(db)
    // token.ts -> session.ts и index.ts -> token.ts, второй одинаковый импорт
    // ложится в тот же первичный ключ и новой строки не создаёт.
    expect(row.n).toBe(2)
    // Счётчик считает всё, что легло в таблицу, а не только импорты: рёбра
    // вызовов пишутся туда же, и расхождение здесь означало бы, что отчёт
    // скана противоречит содержимому базы.
    expect(result.edgesWritten).toBe(all.n)
  })
})

describe('symbol identity', () => {
  it('keeps a class and an interface of the same name apart', async () => {
    const { root, dbPath } = workspace()
    writeFileSync(
      join(root, 'src', 'widget.ts'),
      'export class Widget {}\nexport interface Widget { id: string }\n',
    )
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const rows = db
      .prepare("SELECT symbol_kind FROM nodes WHERE title = 'Widget' ORDER BY symbol_kind")
      .all() as unknown as { symbol_kind: string }[]
    closeDb(db)
    expect(rows.map((r) => r.symbol_kind)).toEqual(['class', 'interface'])
  })

  it('does not fabricate revisions when nothing changed', async () => {
    const { root, dbPath } = workspace()
    writeFileSync(
      join(root, 'src', 'widget.ts'),
      'export class Widget {}\nexport interface Widget { id: string }\nexport const cfg = { render() {} }\nexport function render() {}\n',
    )
    await scanProject({ root, dbPath })
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const row = db
      .prepare("SELECT count(*) AS n FROM revisions WHERE change = 'updated'")
      .get() as unknown as { n: number }
    closeDb(db)
    expect(row.n).toBe(0)
  })

  it('ignores methods of object literals', async () => {
    const { root, dbPath } = workspace()
    writeFileSync(join(root, 'src', 'widget.ts'), 'export const cfg = { render() {} }\nexport function render() {}\n')
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const rows = db
      .prepare("SELECT symbol_kind FROM nodes WHERE title = 'render'")
      .all() as unknown as { symbol_kind: string }[]
    closeDb(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.symbol_kind).toBe('function')
  })
})
