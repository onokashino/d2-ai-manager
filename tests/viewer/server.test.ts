import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanProject } from '../../src/scan/pipeline.js'
import { serveGraph } from '../../src/viewer/server.js'
import type { ViewerGraph } from '../../src/viewer/graph-api.js'
import { readLock, writeLock, clearLock, aliveAt, freePort, lockPath } from '../../src/viewer/lock.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []
const stops: (() => Promise<void>)[] = []

async function scannedProject(): Promise<{ root: string; dbPath: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-viewer-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })
  const dbPath = join(dir, 'graph.sqlite')
  await scanProject({ root, dbPath })
  return { root, dbPath }
}

afterEach(async () => {
  while (stops.length) await stops.pop()!()
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('serveGraph', () => {
  it('serves the graph as json', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    const res = await fetch(`${server.url}api/graph`)
    expect(res.status).toBe(200)

    const graph = (await res.json()) as ViewerGraph
    expect(graph.root).toBe(root.split('\\').join('/'))
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(graph.edges.filter((e) => e.kind === 'imports').length).toBe(2)
    // Вызовы отдаются тем же списком: без них на карте видно, кто кого
    // импортирует, но не видно, кто кого зовёт.
    expect(graph.edges.some((e) => e.kind === 'calls')).toBe(true)
    expect(graph.sessions.length).toBe(1)
  })

  it('reports the symbol kind so the viewer can colour by it', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    const graph = (await (await fetch(`${server.url}api/graph`)).json()) as ViewerGraph
    const verify = graph.nodes.find((n) => n.title === 'verify')
    expect(verify?.symbolKind).toBe('method')
    expect(verify?.file).toBe('src/auth/token.ts')
  })

  it('serves the studio on the root and the code map under /graph', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    const studio = await fetch(server.url)
    expect(studio.headers.get('content-type')).toContain('text/html')
    expect(await studio.text()).toContain('Библиотека логики')

    const graph = await fetch(`${server.url}graph`)
    expect(await graph.text()).toContain('id="canvas"')

    // Страница документа отдаётся по своему адресу, а не переключением вида.
    const page = await fetch(`${server.url}d/docs/logic/whatever.d2`)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('id="viewport"')

    const notADocument = await fetch(`${server.url}d/docs/logic/notes.md`)
    expect(notADocument.status).toBe(404)

    const d3 = await fetch(`${server.url}d3.min.js`)
    expect(d3.status).toBe(200)
    expect((await d3.text()).length).toBeGreaterThan(1000)
  })

  it('serves the logic library and refuses a path that escapes it', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    const library = await (await fetch(`${server.url}api/library`)).json() as { entries: unknown[]; root: string }
    // Корень отдаётся через косую черту: рядом с ним в интерфейсе стоит путь
    // документа, и смешанные разделители читались как D:\project/docs/logic.
    expect(library.root).toBe(root.split('\\').join('/'))
    expect(library.root).not.toContain('\\')
    expect(library.entries).toEqual([])

    // Путь приходит от браузера, поэтому выход за каталог обязан отвергаться.
    const escaped = await fetch(`${server.url}api/document?path=${encodeURIComponent('../../../etc/passwd.d2')}`)
    expect(escaped.status).toBe(400)
  })

  it('answers 404 for anything else', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    expect((await fetch(`${server.url}nope`)).status).toBe(404)
  })

  it('reads the database on each request rather than caching it', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    const before = (await (await fetch(`${server.url}api/graph`)).json()) as ViewerGraph
    // Скан идёт другим процессом жизни базы, а вьювер обязан показать новое.
    await scanProject({ root, dbPath, agent: 'second' })
    const after = (await (await fetch(`${server.url}api/graph`)).json()) as ViewerGraph

    expect(before.sessions.length).toBe(1)
    expect(after.sessions.length).toBe(2)
  })
})

describe('простой студии', () => {
  it('closes itself after sitting unused', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath, idleMinutes: 0.01 })

    // Студия поднимается сама в начале сессии, и без этого сервер, на который
    // никто не смотрит, висел бы до перезагрузки машины.
    await server.closed
    expect(await aliveAt(server.url, 500)).toBe(false)
  })

  it('puts the clock back on every request', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath, idleMinutes: 0.02 })
    stops.push(server.stop)

    // Три обращения подряд, каждое в пределах срока: пока человек смотрит,
    // закрываться нельзя.
    for (let i = 0; i < 3; i += 1) {
      await new Promise((r) => setTimeout(r, 700))
      expect(await aliveAt(server.url, 500)).toBe(true)
    }
  })

  it('stays up forever when no timeout is given', async () => {
    const { root, dbPath } = await scannedProject()
    const server = await serveGraph({ root, dbPath })
    stops.push(server.stop)

    await new Promise((r) => setTimeout(r, 300))
    expect(await aliveAt(server.url, 500)).toBe(true)
  })
})

describe('запись о поднятой студии', () => {
  it('survives a round trip and disappears when cleared', async () => {
    const { root } = await scannedProject()
    await writeLock(root, { port: 41700, url: 'http://127.0.0.1:41700/', pid: 1, startedAt: 'сейчас' })
    expect((await readLock(root))?.port).toBe(41700)

    await clearLock(root)
    expect(await readLock(root)).toBeNull()
  })

  it('reads a missing or broken record as no studio at all', async () => {
    const { root } = await scannedProject()
    expect(await readLock(root)).toBeNull()

    mkdirSync(join(root, '.aimd2'), { recursive: true })
    writeFileSync(lockPath(root), '{ испорчено')
    // Испорченная запись не должна мешать поднять студию заново.
    expect(await readLock(root)).toBeNull()
  })

  it('finds a port nobody is listening on', async () => {
    const { root, dbPath } = await scannedProject()
    const taken = await serveGraph({ root, dbPath, port: 0 })
    stops.push(taken.stop)

    const next = await freePort(taken.port)
    expect(next).not.toBe(taken.port)
    expect(next).toBeGreaterThan(taken.port)
  })
})
