import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, cpSync, existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { run, isDirectLaunch } from '../../src/cli/index.js'
import { defaultDbPath } from '../../src/cli/paths.js'
import { openDb, closeDb } from '../../src/store/db.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-cli-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  return root
}

function captureOut(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  return { lines, restore: () => spy.mockRestore() }
}

function captureErr(): { lines: string[]; restore: () => void } {
  const lines: string[] = []
  const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  return { lines, restore: () => spy.mockRestore() }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('defaultDbPath', () => {
  it('puts the database inside the project data directory', () => {
    expect(defaultDbPath('/tmp/x')).toBe(join('/tmp/x', '.aimd2', 'graph.sqlite'))
  })
})

describe('run', () => {
  it('returns 1 and prints usage for an unknown command', async () => {
    const out = captureOut()
    const code = await run(['bogus'])
    out.restore()
    expect(code).toBe(1)
    expect(out.lines.join('\n')).toContain('aimd2 <command>')
  })

  it('prints an estimate without creating a database', async () => {
    const root = project()
    const out = captureOut()
    const code = await run(['scan', '--path', root, '--estimate'])
    out.restore()
    expect(code).toBe(0)
    expect(out.lines.join('\n')).toContain('3')
  })

  it('scans and reports counts', async () => {
    const root = project()
    const out = captureOut()
    const code = await run(['scan', '--path', root])
    out.restore()
    expect(code).toBe(0)
    expect(out.lines.join('\n')).toMatch(/nodes created/i)
  })

  it('fails loudly when the scan could not write', async () => {
    const root = project()
    // Тот же триггер, что и в тестах хранилища: сбой записи, а не одного файла.
    const prepared = openDb(defaultDbPath(root))
    prepared.exec("CREATE TRIGGER fail_nodes BEFORE INSERT ON nodes BEGIN SELECT RAISE(ABORT, 'disk full'); END")
    closeDb(prepared)

    const out = captureOut()
    const err = captureErr()
    const code = await run(['scan', '--path', root])
    err.restore()
    out.restore()

    expect(code).toBe(1)
    expect(out.lines.join('\n')).toMatch(/files failed: 3/)
    const problem = err.lines.join('\n')
    expect(problem).toMatch(/disk full/)
    expect(problem).toMatch(/session\.ts/)
  })

  it('reports status after a scan', async () => {
    const root = project()
    await run(['scan', '--path', root])
    const out = captureOut()
    const code = await run(['status', '--path', root])
    out.restore()
    expect(code).toBe(0)
    const text = out.lines.join('\n')
    expect(text).toMatch(/nodes/i)
    expect(text).toMatch(/sessions/i)
  })

  it('reports an empty status when nothing was scanned yet', async () => {
    const root = project()
    const out = captureOut()
    const code = await run(['status', '--path', root])
    out.restore()
    expect(code).toBe(0)
    expect(out.lines.join('\n')).toMatch(/no scan yet/i)
  })

  it('refuses to scan a path that does not exist', async () => {
    const missing = join(tmpdir(), `aimd2-missing-${Date.now()}`)
    const err = captureErr()
    const code = await run(['scan', '--path', missing])
    err.restore()
    expect(code).toBe(1)
    expect(err.lines.join('\n')).toMatch(/not a directory/i)
    // Скан не должен создавать каталог, который пользователь набрал с опечаткой.
    expect(existsSync(missing)).toBe(false)
  })

  it('refuses to estimate a path that does not exist', async () => {
    const err = captureErr()
    const code = await run(['scan', '--path', join(tmpdir(), `aimd2-missing-${Date.now()}`), '--estimate'])
    err.restore()
    expect(code).toBe(1)
    expect(err.lines.join('\n')).toMatch(/not a directory/i)
  })

  it('refuses a status on a path that does not exist', async () => {
    const err = captureErr()
    const code = await run(['status', '--path', join(tmpdir(), `aimd2-missing-${Date.now()}`)])
    err.restore()
    expect(code).toBe(1)
    expect(err.lines.join('\n')).toMatch(/not a directory/i)
  })

  it('reports an unknown flag without a stack trace', async () => {
    const root = project()
    const err = captureErr()
    const code = await run(['scan', '--path', root, '--bogus'])
    err.restore()
    expect(code).toBe(1)
    expect(err.lines.join('\n')).not.toMatch(/node:internal/)
  })

  it('prints usage and succeeds for --help', async () => {
    const out = captureOut()
    const code = await run(['--help'])
    out.restore()
    expect(code).toBe(0)
    expect(out.lines.join('\n')).toContain('aimd2 <command>')
  })

  it('seals a document and then notices the code under it changed', async () => {
    const root = project()
    await run(['scan', '--path', root])

    mkdirSync(join(root, 'docs', 'logic'), { recursive: true })
    writeFileSync(
      join(root, 'docs', 'logic', 'a.d2'),
      '# title: X\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n',
      'utf8',
    )

    const sealed = captureOut()
    expect(await run(['logic', 'seal', '--path', root])).toBe(0)
    sealed.restore()
    expect(sealed.lines.join('\n')).toContain('сверен docs/logic/a.d2')
    expect(readFileSync(join(root, 'docs', 'logic', 'a.d2'), 'utf8')).toMatch(/verifyToken@[0-9a-f]{16}/)

    const clean = captureOut()
    expect(await run(['logic', 'check', '--path', root])).toBe(0)
    clean.restore()

    // Тело функции переписано: файл и имя на месте, поведение другое.
    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      'export function verifyToken(raw: string): string {\n  return raw.trim()\n}\n',
      'utf8',
    )
    await run(['scan', '--path', root])

    const drift = captureOut()
    expect(await run(['logic', 'check', '--path', root])).toBe(1)
    drift.restore()
    expect(drift.lines.join('\n')).toContain('код переписали после сверки')
  })

  it('brings the palette along when creating the first document', async () => {
    const root = project()

    const out = captureOut()
    expect(await run(['logic', 'new', 'Статусы заказа', '--path', root])).toBe(0)
    out.restore()

    // Шаблон подключает палитру строкой с тремя точками. Без самой палитры
    // первый же документ в новом проекте не собирался бы.
    expect(existsSync(join(root, 'docs', 'logic', '_palette.d2'))).toBe(true)
    expect(readFileSync(join(root, 'docs', 'logic', '_palette.d2'), 'utf8')).toContain('classes:')
    expect(out.lines.join(' ')).toContain('_palette.d2')
  })

  it('leaves an existing palette alone', async () => {
    const root = project()
    mkdirSync(join(root, 'docs', 'logic'), { recursive: true })
    writeFileSync(join(root, 'docs', 'logic', '_palette.d2'), 'classes: { своё: { shape: oval } }', 'utf8')

    const out = captureOut()
    await run(['logic', 'new', 'Ещё документ', '--path', root])
    out.restore()

    // Палитру правят под проект, и затирать её своей значит сломать все
    // документы разом.
    expect(readFileSync(join(root, 'docs', 'logic', '_palette.d2'), 'utf8')).toContain('своё')
  })

  it('refuses to seal a document it cannot find', async () => {
    const root = project()
    await run(['scan', '--path', root])

    const err = captureErr()
    const out = captureOut()
    const code = await run(['logic', 'seal', 'нет-такого.d2', '--path', root])
    out.restore()
    err.restore()

    expect(code).toBe(1)
    expect(err.lines.join('\n')).toContain('нечего отмечать')
  })
})

describe('isDirectLaunch', () => {
  const real = 'D:/projects/aimd2/dist/cli/index.js'
  const url = pathToFileURL(real).href

  it('распознаёт запуск файла напрямую', () => {
    expect(isDirectLaunch(real, url, (p) => p)).toBe(true)
  })

  it('распознаёт запуск через симлинк, который кладёт npm link', () => {
    // Узел разрешает ссылку сам, поэтому import.meta.url уже настоящий путь, а
    // argv[1] всё ещё путь ссылки. Пока сравнивали их в лоб, поставленный через
    // npm link CLI молча не делал ничего.
    const link = 'C:/nodejs/node_modules/aimd2/dist/cli/index.js'
    expect(isDirectLaunch(link, url, () => real)).toBe(true)
  })

  it('не считает прямым запуском подключение из другого файла', () => {
    expect(isDirectLaunch('C:/other/thing.js', url, (p) => p)).toBe(false)
  })

  it('молчит, когда точки входа нет', () => {
    expect(isDirectLaunch(undefined, url, (p) => p)).toBe(false)
    expect(
      isDirectLaunch(real, url, () => {
        throw new Error('ENOENT')
      }),
    ).toBe(false)
  })
})

describe('init', () => {
  it('points at scan while the map does not exist yet', async () => {
    const root = project()
    const out = captureOut()
    await run(['init', 'claude', '--path', root])
    out.restore()
    expect(out.lines.join('\n')).toContain('aimd2 scan')
  })

  it('says nothing about scanning once the map is there', async () => {
    const root = project()
    await run(['scan', '--path', root])

    const out = captureOut()
    await run(['init', 'claude', '--path', root])
    out.restore()
    // Совет сканировать сразу после скана читается как сообщение об ошибке.
    expect(out.lines.join('\n')).not.toContain('карта ещё не построена')
  })
})
