import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb, closeDb } from '../store/db.js'
import { readGraph } from './graph-api.js'
import { libraryView, documentView, saveDocument, confirmDocument, type SaveRequest } from './studio-api.js'
import { neighbourFiles } from '../logic/library.js'
import { readPalette, D2_SHAPES, D2_KEYWORDS } from '../logic/palette.js'
import { renderDiagram, asLayout, asAppearance } from '../logic/render.js'
import { setupView, applySetup } from './setup-api.js'

const require = createRequire(import.meta.url)
const VIEWER_DIR = dirname(fileURLToPath(import.meta.url))

export interface ServeOptions {
  root: string
  dbPath: string
  port?: number
  /**
   * Через сколько минут без запросов закрыться. Ноль означает никогда.
   *
   * Нужно поднятой самой студии: её открывают не каждую сессию, и сервер,
   * на который никто не смотрит, иначе висел бы до перезагрузки машины.
   */
  idleMinutes?: number
}

export interface RunningServer {
  port: number
  url: string
  stop: () => Promise<void>
  /** Резолвится, когда сервер закрылся: сам по простою или чужой рукой. */
  closed: Promise<void>
}

async function bundledD3(): Promise<string> {
  // d3 поставляется готовым UMD-бандлом, поэтому вьюверу не нужна сборка.
  // Путь к файлу собирается от точки входа пакета: сам файл закрыт полем
  // exports, и обратиться к нему по имени напрямую нельзя.
  const entry = require.resolve('d3')
  const packageRoot = dirname(dirname(entry))
  return readFile(join(packageRoot, 'dist', 'd3.min.js'), 'utf8')
}

// Шрифты лежат в пакетах fontsource, файлы отдаются под короткими именами,
// чтобы css не знал про структуру node_modules.
const FONTS: Record<string, string> = {
  'inter-cyrillic.woff2': '@fontsource-variable/inter/files/inter-cyrillic-opsz-normal.woff2',
  'inter-latin.woff2': '@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2',
  'mono-cyrillic-400.woff2': '@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-400-normal.woff2',
  'mono-latin-400.woff2': '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2',
  'mono-cyrillic-500.woff2': '@fontsource/jetbrains-mono/files/jetbrains-mono-cyrillic-500-normal.woff2',
  'mono-latin-500.woff2': '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff2',
}

function fontPath(name: string): string | null {
  const relative = FONTS[name]
  if (!relative) return null
  const cut = relative.lastIndexOf('/files/')
  const pkg = relative.slice(0, cut)
  const file = relative.slice(cut + 1)
  try {
    // У пакетов шрифтов нет поля exports, поэтому путь собирается от package.json.
    return join(dirname(require.resolve(`${pkg}/package.json`)), file)
  } catch {
    return null
  }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * Отсекает путь, уводящий за пределы каталога документов. Редактор принимает
 * путь от браузера, и без этой проверки он читал бы и писал что угодно.
 */
function safeDocPath(raw: string): string | null {
  const clean = normalize(raw).split('\\').join('/')
  if (clean.startsWith('..') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return null
  if (!clean.endsWith('.d2')) return null
  return clean
}

export async function serveGraph(opts: ServeOptions): Promise<RunningServer> {
  // Страницы настоящие, а не одно приложение с переключением видов: ссылку на
  // документ можно открыть напрямую, и кнопка назад в браузере работает.
  const pages: Record<string, string> = {
    library: 'library.html',
    document: 'document.html',
    graph: 'index.html',
    guide: 'guide.html',
    setup: 'setup.html',
  }
  const modules: Record<string, string> = {
    '/ui.js': 'ui.js',
    '/icons.js': 'icons.js',
    '/shared.js': 'shared.js',
    '/editor.js': 'editor.js',
    '/i18n.js': 'i18n.js',
    '/guide-content.js': 'guide-content.js',
  }
  const d3 = await bundledD3()

  // Страницы, стили и модули читаются с диска на каждый запрос и не кешируются.
  // Файлы крошечные, а держать их в памяти значило бы перезапускать студию
  // после каждой правки интерфейса.
  const NO_CACHE = 'no-store, must-revalidate'
  const asset = (name: string): Promise<string> => readFile(join(VIEWER_DIR, name), 'utf8')

  const html = async (res: ServerResponse, page: string): Promise<void> => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': NO_CACHE })
    res.end(await asset(pages[page] as string))
  }

  const json = (res: ServerResponse, code: number, payload: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = url.pathname

    const withDb = async <T>(fn: (db: ReturnType<typeof openDb>) => Promise<T> | T): Promise<T> => {
      // База открывается на каждый запрос: скан мог пройти в другом процессе,
      // и держать соединение значило бы показывать устаревшую карту.
      const db = openDb(opts.dbPath)
      try {
        return await fn(db)
      } finally {
        closeDb(db)
      }
    }

    void (async () => {
      try {
        if (path === '/api/library') {
          return json(res, 200, await withDb((db) => libraryView(db, opts.root)))
        }

        if (path === '/api/document') {
          const wanted = safeDocPath(url.searchParams.get('path') ?? '')
          if (!wanted) return json(res, 400, { error: 'bad path' })
          const layout = asLayout(url.searchParams.get('layout'))
          const look = asAppearance(url.searchParams.get('appearance'))
          const board = url.searchParams.get('target') ?? ''
          return json(res, 200, await withDb((db) => documentView(db, opts.root, wanted, layout, look, board)))
        }

        if (path === '/api/render' && req.method === 'POST') {
          const body = (await readBody(req)) as {
            source?: string
            layout?: string
            appearance?: string
            target?: string
          }
          const neighbours = await neighbourFiles(opts.root)
          return json(
            res,
            200,
            await renderDiagram(
              body.source ?? '',
              asLayout(body.layout),
              asAppearance(body.appearance),
              neighbours,
              body.target ?? '',
            ),
          )
        }

        if (path === '/api/save' && req.method === 'POST') {
          const body = (await readBody(req)) as SaveRequest
          const wanted = safeDocPath(body.path ?? '')
          if (!wanted) return json(res, 400, { error: 'bad path' })
          await saveDocument(opts.root, { ...body, path: wanted })
          return json(res, 200, { saved: wanted })
        }

        if (path === '/api/confirm' && req.method === 'POST') {
          const body = (await readBody(req)) as { path?: string }
          const wanted = safeDocPath(body.path ?? '')
          if (!wanted) return json(res, 400, { error: 'bad path' })
          await withDb((db) => confirmDocument(db, opts.root, wanted))
          return json(res, 200, { confirmed: wanted })
        }

        if (path === '/api/config' && req.method === 'POST') {
          return json(res, 200, { config: await applySetup(opts.root, await readBody(req)) })
        }

        if (path === '/api/config') {
          return json(res, 200, await setupView(opts.root))
        }

        if (path === '/api/palette') {
          // Подсказки редактора и легенда берутся из самой палитры, иначе они
          // разойдутся с ней при первой же правке.
          return json(res, 200, {
            classes: await readPalette(opts.root),
            shapes: D2_SHAPES,
            keywords: D2_KEYWORDS,
          })
        }

        if (path === '/api/graph') {
          return json(res, 200, await withDb((db) => readGraph(db, opts.root)))
        }

        if (path.startsWith('/fonts/')) {
          const file = fontPath(path.slice('/fonts/'.length))
          if (!file) {
            res.writeHead(404)
            return res.end()
          }
          res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' })
          return res.end(await readFile(file))
        }

        if (path === '/ui.css') {
          res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': NO_CACHE })
          return res.end(await asset('ui.css'))
        }

        if (modules[path]) {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': NO_CACHE })
          return res.end(await asset(modules[path] as string))
        }

        if (path === '/d3.min.js') {
          res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
          return res.end(d3)
        }

        if (path === '/graph') return await html(res, 'graph')

        if (path === '/guide') return await html(res, 'guide')
        if (path === '/setup') return await html(res, 'setup')

        // Страница документа: путь к файлу идёт прямо в адресе после /d/.
        if (path.startsWith('/d/')) {
          const wanted = safeDocPath(decodeURIComponent(path.slice('/d/'.length)))
          if (!wanted) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
            return res.end('not a document')
          }
          return await html(res, 'document')
        }

        if (path === '/') return await html(res, 'library')

        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('not found')
      } catch (error) {
        json(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })

  let done = () => {}
  const closed = new Promise<void>((resolve) => {
    done = resolve
  })
  server.on('close', () => done())

  const idleMs = (opts.idleMinutes ?? 0) * 60_000
  let idle: NodeJS.Timeout | null = null
  const touch = () => {
    if (idleMs <= 0) return
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => void close(), idleMs)
  }
  const close = () =>
    new Promise<void>((resolve) => {
      if (idle) clearTimeout(idle)
      server.close(() => resolve())
    })

  server.on('request', touch)

  const port = await new Promise<number>((resolve, reject) => {
    server.on('error', reject)
    // Порт 0 означает любой свободный: занятый порт не должен мешать запуску.
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address !== null ? address.port : 0)
    })
  })

  touch()

  return {
    port,
    url: `http://127.0.0.1:${port}/`,
    stop: close,
    closed,
  }
}
