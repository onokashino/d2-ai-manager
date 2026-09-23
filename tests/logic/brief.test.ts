import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProject } from '../../src/scan/pipeline.js'
import { openDb, closeDb } from '../../src/store/db.js'
import { buildBrief, formatBrief } from '../../src/logic/brief.js'
import { parseDocument } from '../../src/logic/document.js'
import { sealAnchors } from '../../src/logic/library.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

const ANCHORED = '# title: Проверка подписи\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n'

function workspace(): { root: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-brief-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  return { root, dbPath: join(dir, 'graph.sqlite') }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('buildBrief', () => {
  it('puts the document and the code under its anchor side by side', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const brief = await buildBrief(db, root, parseDocument('docs/logic/a.d2', ANCHORED))
    closeDb(db)

    expect(brief.title).toBe('Проверка подписи')
    expect(brief.stale).toBe(false)
    expect(brief.anchors).toHaveLength(1)
    // Тело символа, а не весь файл: искать его глазами по репозиторию и есть
    // та работа, которую сводка снимает.
    expect(brief.anchors[0]?.source).toContain('export function verifyToken')
    expect(brief.anchors[0]?.source).not.toContain('export class TokenService')
  })

  it('marks the anchor whose code was rewritten', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    let db = openDb(dbPath)
    const sealed = sealAnchors(db, parseDocument('docs/logic/a.d2', ANCHORED))
    closeDb(db)

    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      'export function verifyToken(raw: string): string {\n  return raw.trim()\n}\n',
      'utf8',
    )
    await scanProject({ root, dbPath })

    db = openDb(dbPath)
    const brief = await buildBrief(db, root, sealed)
    closeDb(db)

    expect(brief.stale).toBe(true)
    expect(brief.anchors[0]?.reason).toBe('drifted')
    expect(brief.anchors[0]?.source).toContain('raw.trim()')
  })

  it('says plainly when the code under an anchor is gone', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    writeFileSync(join(root, 'src', 'auth', 'token.ts'), 'export interface User { id: string }\n', 'utf8')
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const brief = await buildBrief(db, root, parseDocument('docs/logic/a.d2', ANCHORED))
    closeDb(db)

    expect(brief.anchors[0]?.reason).toBe('symbol-missing')
    expect(brief.anchors[0]?.source).toBe('')
  })

  it('does not unfold a whole file behind a file level anchor', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const doc = parseDocument('docs/logic/a.d2', '# title: X\n# anchors: src/auth/token.ts\n\na -> b\n')
    const db = openDb(dbPath)
    const brief = await buildBrief(db, root, doc)
    closeDb(db)

    // Целый файл в сводке съест больше контекста, чем даст пользы, а документ
    // обычно описывает не весь файл.
    expect(brief.anchors[0]?.source).toBe('')
    expect(formatBrief(brief)).toContain('тело не разворачивается')
  })
})

describe('formatBrief', () => {
  it('names the document, its state and what to do next', async () => {
    const { root, dbPath } = workspace()
    await scanProject({ root, dbPath })

    const db = openDb(dbPath)
    const text = formatBrief(await buildBrief(db, root, parseDocument('docs/logic/a.d2', ANCHORED)))
    closeDb(db)

    expect(text).toContain('Проверка подписи')
    expect(text).toContain('src/auth/token.ts:verifyToken')
    expect(text).toContain('aimd2 logic seal docs/logic/a.d2')
  })
})
