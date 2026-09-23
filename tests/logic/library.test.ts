import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProject } from '../../src/scan/pipeline.js'
import { openDb, closeDb } from '../../src/store/db.js'
import {
  listDocuments,
  checkAnchors,
  checkLibrary,
  sealAnchors,
  shownStatus,
} from '../../src/logic/library.js'
import { parseDocument } from '../../src/logic/document.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')

/** Документ с одним якорем на функцию из фикстуры. */
const ANCHORED = '# title: X\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n'
const dirs: string[] = []

function workspace(): { root: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-logic-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  return { root, dbPath: join(dir, 'graph.sqlite') }
}

function writeDoc(root: string, name: string, source: string): void {
  mkdirSync(join(root, 'docs', 'logic'), { recursive: true })
  writeFileSync(join(root, 'docs', 'logic', name), source)
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('listDocuments', () => {
  it('returns nothing when the directory does not exist', async () => {
    const { root } = workspace()
    expect(await listDocuments(root)).toEqual([])
  })

  it('reads every d2 document and ignores other files', async () => {
    const { root } = workspace()
    writeDoc(root, 'a.d2', '# title: Первый\n\na -> b\n')
    writeDoc(root, 'b.d2', '# title: Второй\n\nc -> d\n')
    writeDoc(root, 'notes.md', 'not a document')

    const docs = await listDocuments(root)
    expect(docs.map((d) => d.title)).toEqual(['Первый', 'Второй'])
    expect(docs[0]?.path).toBe('docs/logic/a.d2')
  })
})

describe('checkAnchors', () => {
  it('accepts anchors that point at real code', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const doc = parseDocument('docs/logic/a.d2', '# title: X\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n')
    const db = openDb(dbPath)
    const broken = checkAnchors(db, doc)
    closeDb(db)
    expect(broken).toEqual([])
  })

  it('reports an anchor whose file is not in the project', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const doc = parseDocument('docs/logic/a.d2', '# title: X\n# anchors: src/gone.ts:handler\n\na -> b\n')
    const db = openDb(dbPath)
    const broken = checkAnchors(db, doc)
    closeDb(db)
    expect(broken).toEqual([
      { file: 'src/gone.ts', symbol: 'handler', fingerprint: '', reason: 'file-missing' },
    ])
  })

  it('reports an anchor whose symbol disappeared from a file that stayed', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    // Функция исчезает, файл остаётся: ровно тот случай, ради которого
    // документы вообще привязываются к коду.
    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      "import { touchSession } from './session'\n\nexport interface User { id: string }\n",
    )
    await scanProject({ root, dbPath })

    const doc = parseDocument('docs/logic/a.d2', '# title: X\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n')
    const db = openDb(dbPath)
    const broken = checkAnchors(db, doc)
    closeDb(db)
    expect(broken).toEqual([
      { file: 'src/auth/token.ts', symbol: 'verifyToken', fingerprint: '', reason: 'symbol-missing' },
    ])
  })

  it('stays quiet while the code under a sealed anchor is untouched', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const doc = parseDocument('docs/logic/a.d2', ANCHORED)
    const sealed = sealAnchors(db, doc)
    const broken = checkAnchors(db, sealed)
    closeDb(db)

    expect(sealed.anchors[0]?.fingerprint).toMatch(/^[0-9a-f]{16}$/)
    expect(broken).toEqual([])
  })

  it('reports drift when the body of an anchored symbol was rewritten', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    let db = openDb(dbPath)
    const sealed = sealAnchors(db, parseDocument('docs/logic/a.d2', ANCHORED))
    closeDb(db)

    // Имя и файл на месте, переписано тело: ровно тот случай, который старая
    // проверка считала целым якорем, хотя документ мог уже врать.
    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      [
        "import { touchSession } from './session'",
        '',
        'export interface User { id: string }',
        '',
        'export function verifyToken(raw: string): User {',
        '  touchSession(raw)',
        '  return { id: raw.toUpperCase() }',
        '}',
        '',
      ].join('\n'),
    )
    await scanProject({ root, dbPath })

    db = openDb(dbPath)
    const broken = checkAnchors(db, sealed)
    closeDb(db)

    expect(broken.map((b) => b.reason)).toEqual(['drifted'])
  })

  it('does not call reformatting a change', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    let db = openDb(dbPath)
    const sealed = sealAnchors(db, parseDocument('docs/logic/a.d2', ANCHORED))
    closeDb(db)

    // Те же знаки, другие переносы и отступы. Поведение не изменилось, и после
    // прогона форматтера документ не должен помечаться разошедшимся.
    const file = join(root, 'src', 'auth', 'token.ts')
    writeFileSync(
      file,
      readFileSync(file, 'utf8').replace(
        'export function verifyToken(raw: string): User {\n  return new TokenService().verify(raw)\n}',
        'export function verifyToken(raw: string): User\n{\n\n      return new TokenService().verify(raw)\n\n}',
      ),
    )
    await scanProject({ root, dbPath })

    db = openDb(dbPath)
    const broken = checkAnchors(db, sealed)
    closeDb(db)

    expect(broken).toEqual([])
  })

  it('says nothing about an anchor that was never sealed', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      'export function verifyToken(raw: string): string {\n  return raw\n}\n',
    )
    await scanProject({ root, dbPath })

    // Отпечатка нет, сверять не с чем: молчание честнее ложной тревоги.
    const db = openDb(dbPath)
    const broken = checkAnchors(db, parseDocument('docs/logic/a.d2', ANCHORED))
    closeDb(db)

    expect(broken).toEqual([])
  })
})

describe('checkLibrary', () => {
  it('pairs every document with its broken anchors', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })
    writeDoc(root, 'ok.d2', '# title: Цел\n# anchors: src/auth/token.ts\n\na -> b\n')
    writeDoc(root, 'stale.d2', '# title: Протух\n# anchors: src/nowhere.ts\n\na -> b\n')

    const db = openDb(dbPath)
    const checked = await checkLibrary(db, root)
    closeDb(db)

    expect(checked.find((d) => d.title === 'Цел')?.broken).toEqual([])
    expect(checked.find((d) => d.title === 'Протух')?.broken).toHaveLength(1)
  })
})

describe('sealAnchors', () => {
  it('writes down who checked the document', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const byAgent = sealAnchors(db, parseDocument('docs/logic/a.d2', ANCHORED))
    const byHuman = sealAnchors(db, parseDocument('docs/logic/a.d2', ANCHORED), 'human')
    closeDb(db)

    // Кто сверял, и есть весь смысл отметки: документ, который агент и написал,
    // и сам объявил верным, иначе неотличим от прочитанного человеком.
    expect(byAgent.checked?.by).toBe('agent')
    expect(byHuman.checked?.by).toBe('human')
    expect(byHuman.checked?.on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('shownStatus', () => {
  const doc = (status: string) => parseDocument('a.d2', `# title: X\n# status: ${status}\n\na -> b\n`)
  const drift = [{ file: 'a.ts', symbol: 'f', fingerprint: '', reason: 'drifted' as const }]

  it('leaves the status alone while everything matches', () => {
    for (const s of ['draft', 'review', 'approved']) {
      expect(shownStatus(doc(s), [])).toBe(s)
    }
  })

  it('shows an approved document as outdated once the code moved', () => {
    // Подтверждали одно, в репозитории другое: зелёный бейдж тут врёт.
    expect(shownStatus(doc('approved'), drift)).toBe('outdated')
  })

  it('does not promote a draft to anything', () => {
    // Черновик и так никто не подтверждал, объявлять его устаревшим не за что.
    expect(shownStatus(doc('draft'), drift)).toBe('draft')
    expect(shownStatus(doc('review'), drift)).toBe('review')
  })
})
