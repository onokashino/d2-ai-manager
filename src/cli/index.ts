#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { existsSync, statSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { scanProject, estimateScan } from '../scan/pipeline.js'
import { openDb, closeDb } from '../store/db.js'
import { defaultDbPath } from './paths.js'
import { serveGraph } from '../viewer/server.js'
import { readLock, writeLock, clearLock, aliveAt, freePort } from '../viewer/lock.js'
import { listDocuments, checkLibrary, sealAnchors } from '../logic/library.js'
import { loadConfig } from '../logic/config.js'
import { toPosix } from '../graph/ids.js'
import { buildBrief, formatBrief } from '../logic/brief.js'
import { findGaps } from '../logic/gaps.js'
import { runHook } from './hook.js'
import { initCli, isBroken, cliTarget, hookCommand, type Cli } from './init.js'
import { serializeDocument } from '../logic/document.js'
import { ensurePalette } from '../logic/palette-template.js'
import { checkFlow, traceCalls, type FlowStep, type TraceNode } from '../logic/flow.js'
import { runDraft, runBackfill } from '../logic/draft.js'
import { spawn } from 'node:child_process'
import { closeRenderer } from '../logic/render.js'
import { PACKAGE_VERSION } from '../version.js'

const DEFAULT_PORT = 41700

const USAGE = `aimd2 <command>

Commands:
  scan     [--path <dir>] [--estimate]   построить или обновить структурный слой
  status   [--path <dir>]                показать состояние карты
  serve    [--path <dir>] [--port <n>] [--auto] [--idle <мин>]  открыть студию
  logic    list | check | brief | gaps | trace | backfill | seal [--human] | new <название>
  hook                                   точка для хуков ИИ-консолей, читает событие со входа
  init     [claude] [codex] [--local]    прописать хуки в настройки консоли
  draft    --session <id> [--model <имя>] черновик документа по ходу сессии, зовут хуки

Options:
  --path      корень проекта, по умолчанию текущий каталог
  --estimate  только смета, база не создаётся
  --port      порт студии, по умолчанию 41700
  --auto      занять первый свободный порт и не поднимать вторую студию
  --idle      закрыться после стольких минут без запросов, 0 значит никогда
  --local     хук зовёт эту сборку aimd2 по абсолютному пути, без npm link
  --human     отметку о сверке ставит человек, а не агент
  --depth     насколько глубоко идёт trace, по умолчанию 3
  --session   идентификатор сессии консоли, откуда брать ход работы
  --model     дешёвая модель для черновиков, по умолчанию haiku
  --limit     сколько связок разобрать за раз в backfill, по умолчанию 5`

interface ParsedArgs {
  path?: string | undefined
  estimate: boolean
  /** Звать собранный CLI по пути, а не глобально поставленный aimd2. */
  local: boolean
  /** Отметку о сверке ставит человек, а не агент. */
  human: boolean
  port?: string | undefined
  /** Поднять студию самостоятельно: свободный порт и выход по простою. */
  auto: boolean
  idle?: string | undefined
  depth?: string | undefined
  session?: string | undefined
  model?: string | undefined
  limit?: string | undefined
  /** Позиционные аргументы после имени команды: подкоманда и её данные. */
  rest: string[]
}

// parseArgs работает в строгом режиме и бросает на неизвестном флаге или
// потерянном значении. Без перехвата пользователь получал бы стектрейс.
function parse(argv: string[]): ParsedArgs | null {
  try {
    const { values, positionals } = parseArgs({
      args: argv.slice(1),
      options: {
        path: { type: 'string' },
        estimate: { type: 'boolean', default: false },
        local: { type: 'boolean', default: false },
        human: { type: 'boolean', default: false },
        port: { type: 'string' },
        auto: { type: 'boolean', default: false },
        idle: { type: 'string' },
        depth: { type: 'string' },
        session: { type: 'string' },
        model: { type: 'string' },
        limit: { type: 'string' },
      },
      allowPositionals: true,
    })
    // Позиционные берутся у parseArgs, а не отсеиванием строк на дефис:
    // иначе значение флага, например путь после --path, уезжало бы в них.
    return {
      path: values.path,
      estimate: values.estimate ?? false,
      local: values.local ?? false,
      human: values.human ?? false,
      port: values.port,
      auto: values.auto ?? false,
      idle: values.idle,
      depth: values.depth,
      session: values.session,
      model: values.model,
      limit: values.limit,
      rest: positionals,
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return null
  }
}

// Путь проверяется до любой работы: иначе скан несуществующего каталога молча
// создавал бы его вместе с базой и рапортовал об успехе, оценка падала бы
// стектрейсом, а статус отвечал бы "сканирования ещё не было".
function resolveRoot(raw: string | undefined): string | null {
  const root = resolve(raw ?? process.cwd())
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`not a directory: ${root}`)
    return null
  }
  return root
}

async function cmdScan(argv: string[]): Promise<number> {
  const values = parse(argv)
  if (!values) return 1
  const root = resolveRoot(values.path)
  if (!root) return 1

  if (values.estimate) {
    const est = await estimateScan(root)
    console.log(`files: ${est.files}`)
    for (const [lang, n] of Object.entries(est.byLanguage).sort()) console.log(`  ${lang}: ${n}`)
    return 0
  }

  const result = await scanProject({ root, dbPath: defaultDbPath(root) })
  console.log(`files scanned: ${result.filesScanned}, skipped: ${result.filesSkipped}`)
  // Строка печатается только когда есть о чём сообщать: молчаливый ноль в
  // каждом выводе приучил бы не читать эту строку вообще.
  if (result.filesFailed > 0) console.log(`files failed: ${result.filesFailed}`)
  console.log(`nodes created: ${result.nodesCreated}, updated: ${result.nodesUpdated}, removed: ${result.nodesRemoved}`)
  console.log(`edges written: ${result.edgesWritten}`)

  if (result.firstFailure) {
    // Причина и ненулевой код возврата обязательны: под сбоем одного файла
    // может прятаться отказ самой базы, а карта после такого скана неполна.
    console.error(`first failure: ${result.firstFailure.path}: ${result.firstFailure.message}`)
    return 1
  }
  return 0
}

async function cmdStatus(argv: string[]): Promise<number> {
  const values = parse(argv)
  if (!values) return 1
  const root = resolveRoot(values.path)
  if (!root) return 1
  const dbPath = defaultDbPath(root)

  if (!existsSync(dbPath)) {
    console.log('no scan yet, run: aimd2 scan')
    return 0
  }

  const db = openDb(dbPath)
  const nodes = db.prepare("SELECT count(*) AS n FROM nodes WHERE status <> 'removed'").get() as { n: number }
  const removed = db.prepare("SELECT count(*) AS n FROM nodes WHERE status = 'removed'").get() as { n: number }
  // Считаются связи между живыми узлами. Ребро переживает уход файла из
  // карты, и общее число рядом с числом живых узлов читалось бы как
  // противоречие: связей больше, чем есть чему связываться.
  const edges = db
    .prepare(
      `SELECT count(*) AS n FROM edges e
       JOIN nodes f ON f.id = e.from_id AND f.status <> 'removed'
       JOIN nodes t ON t.id = e.to_id AND t.status <> 'removed'`,
    )
    .get() as { n: number }
  const files = db.prepare('SELECT count(*) AS n FROM files').get() as { n: number }
  const sessions = db.prepare('SELECT count(*) AS n FROM sessions').get() as { n: number }
  closeDb(db)

  console.log(`nodes: ${nodes.n} live, ${removed.n} removed`)
  console.log(`edges: ${edges.n}`)
  console.log(`files: ${files.n}`)
  console.log(`sessions: ${sessions.n}`)
  return 0
}

async function cmdServe(argv: string[]): Promise<number> {
  const values = parse(argv)
  if (!values) return 1
  const root = resolveRoot(values.path)
  if (!root) return 1

  const dbPath = defaultDbPath(root)
  if (!existsSync(dbPath)) {
    console.error('no scan yet, run: aimd2 scan')
    return 1
  }

  // Порт по умолчанию постоянный: иначе каждый запуск даёт новый адрес, старые
  // процессы остаются висеть, и непонятно, какую вкладку смотреть.
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port)
  if (!Number.isInteger(port)) {
    console.error(`not a port: ${values.port}`)
    return 1
  }

  const idleMinutes = values.idle === undefined ? (values.auto ? 60 : 0) : Number(values.idle)
  if (!Number.isInteger(idleMinutes) || idleMinutes < 0) {
    console.error(`не число минут: ${values.idle}`)
    return 1
  }

  if (values.auto) {
    // Вторая студия того же проекта не нужна: человек не поймёт, какую из двух
    // вкладок смотреть. Проверяется живой ответ, а не наличие записи: процесс
    // мог умереть, не убрав её за собой.
    const existing = await readLock(root)
    if (existing && (await aliveAt(existing.url))) {
      console.log(`студия уже открыта: ${existing.url}`)
      return 0
    }

    const chosen = values.port === undefined ? await freePort(DEFAULT_PORT) : port
    const auto = await serveGraph({ root, dbPath, port: chosen, idleMinutes })
    await writeLock(root, {
      port: auto.port,
      url: auto.url,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    })
    console.log(`студия открыта: ${auto.url}`)
    try {
      await auto.closed
    } finally {
      await clearLock(root)
    }
    return 0
  }

  let server
  try {
    server = await serveGraph({ root, dbPath, port, idleMinutes })
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'EADDRINUSE') {
      console.error(`порт ${port} уже занят, скорее всего студия уже запущена: http://127.0.0.1:${port}/`)
      console.error('останови тот процесс или укажи другой порт через --port')
      return 1
    }
    throw error
  }

  console.log(`студия открыта: ${server.url}`)
  console.log('остановить: Ctrl+C')
  // Промис намеренно не резолвится: процесс живёт, пока сервер слушает.
  await new Promise<void>(() => {})
  return 0
}

async function cmdDraft(argv: string[]): Promise<number> {
  const values = parse(argv)
  if (!values) return 1
  const root = resolveRoot(values.path)
  if (!root) return 1

  const sessionId = values.session ?? process.env.CLAUDE_CODE_SESSION_ID ?? ''
  if (!sessionId) {
    console.error('нужен идентификатор сессии: aimd2 draft --session <id>')
    return 1
  }

  const dbPath = defaultDbPath(root)
  if (!existsSync(dbPath)) {
    console.error('no scan yet, run: aimd2 scan')
    return 1
  }

  const db = openDb(dbPath)
  try {
    const config = await loadConfig(root)
    const result = await runDraft({
      root,
      db,
      sessionId,
      model: values.model ?? config.model,
      docsDir: config.docsDir,
    })
    if (result.action === 'skipped') console.log(`ничего не написано: ${result.why}`)
    else console.log(`${result.action === 'created' ? 'заведён' : 'обновлён'}: ${result.path}`)
    // Ноль всегда: черновик это подсказка, а не проверка, и провалить им
    // чужую сборку было бы неуместно.
    return 0
  } finally {
    closeDb(db)
    // Рисовальщик держит рабочий поток WebAssembly, и без остановки процесс
    // не заканчивается вовсе. Хук запускает его после каждого хода, так что
    // повисший процесс копился бы весь день.
    await closeRenderer()
  }
}

function printTrace(node: TraceNode, indent: string): void {
  console.log(`${indent}${node.step.file}:${node.step.symbol}`)
  for (const child of node.calls) printTrace(child, `${indent}  `)
}

async function cmdLogic(argv: string[]): Promise<number> {
  const values = parse(argv)
  if (!values) return 1
  const root = resolveRoot(values.path)
  if (!root) return 1

  const action = values.rest[0] ?? 'list'
  const args = values.rest.slice(1)
  const config = await loadConfig(root)
  const docsDir = config.docsDir

  if (action === 'new') {
    const title = args.join(' ').trim()
    if (!title) {
      console.error('нужно название: aimd2 logic new "Статусы заявки"')
      return 1
    }
    // Имя файла выводится из названия: латиница и цифры остаются, остальное
    // становится дефисом, чтобы путь был предсказуем и без пробелов.
    const slug = title.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '') || 'document'
    const relative = `${docsDir}/${slug}.d2`
    const target = resolve(root, relative)
    if (existsSync(target)) {
      console.error(`уже есть: ${relative}`)
      return 1
    }
    const body = [
      '...@_palette',
      '',
      'direction: down',
      '',
      'a: Первый шаг { class: step }',
      'b: Второй шаг { class: step }',
      'a -> b: что происходит',
      '',
    ].join(String.fromCharCode(10))
    mkdirSync(dirname(target), { recursive: true })
    // Шаблон подключает палитру, и в новом проекте её ещё нет.
    const palette = await ensurePalette(root, docsDir)
    if (palette) console.log(`создан словарь ролей: ${palette}`)

    writeFileSync(
      target,
      serializeDocument({
        path: relative,
        title,
        status: 'draft',
        area: '',
        summary: '',
        updated: new Date().toISOString().slice(0, 10),
        checked: null,
        anchors: [],
        flow: [],
        body,
      }),
      'utf8',
    )
    console.log(`создан: ${relative}`)
    return 0
  }

  if (action === 'list') {
    const docs = await listDocuments(root, docsDir)
    if (docs.length === 0) {
      console.log(`документов нет, каталог ${docsDir}`)
      return 0
    }
    for (const doc of docs) {
      console.log(`${doc.status.padEnd(9)} ${doc.area.padEnd(10)} ${doc.title}`)
      console.log(`          ${doc.path}`)
    }
    return 0
  }

  if (action === 'check') {
    const dbPath = defaultDbPath(root)
    if (!existsSync(dbPath)) {
      console.error('no scan yet, run: aimd2 scan')
      return 1
    }
    const db = openDb(dbPath)
    const checked = await checkLibrary(db, root, docsDir)
    const flows = checked
      .filter((d) => d.flow.length > 0)
      .map((doc) => ({ doc, issues: checkFlow(db, doc.flow) }))
      .filter((f) => f.issues.length > 0)
    closeDb(db)

    // Пропавший шаг это факт той же силы, что и сломанный якорь. Невидимый
    // переход это подозрение: карта вызовов не знает вызовов через точку.
    const gone = flows.filter((f) => f.issues.some((i) => i.kind === 'step-missing'))
    const sayFlow = () => {
      if (flows.length === 0) return
      console.log('Ход через код:')
      for (const { doc, issues } of flows) {
        console.log(`  ${doc.title} (${doc.path})`)
        for (const issue of issues) {
          if (issue.kind === 'step-missing') {
            console.log(`    ${issue.step.file}:${issue.step.symbol} - шага нет в карте`)
          } else {
            console.log(`    ${issue.from.symbol} -> ${issue.to.symbol} - перехода не видно, проверьте`)
          }
        }
      }
    }

    // Подтверждённый документ, которого человек ни разу не читал, это не
    // расхождение с кодом, но и доверия ему ровно столько же, сколько агенту.
    const unconfirmed = checked.filter((d) => d.status === 'approved' && d.checked?.by !== 'human')
    const sayUnconfirmed = () => {
      if (unconfirmed.length === 0) return
      console.log(`подтверждено, но человеком не сверялось: ${unconfirmed.length}`)
      for (const doc of unconfirmed) console.log(`  ${doc.title} (${doc.path})`)
    }

    const stale = checked.filter((d) => d.broken.length > 0)
    if (stale.length === 0) {
      console.log(`документов: ${checked.length}, расхождений с кодом нет`)
      sayFlow()
      sayUnconfirmed()
      return unconfirmed.length > 0 || gone.length > 0 ? 1 : 0
    }
    for (const doc of stale) {
      console.log(`${doc.title} (${doc.path})`)
      for (const anchor of doc.broken) {
        const why =
          anchor.reason === 'file-missing' ? 'файла нет'
          : anchor.reason === 'symbol-missing' ? 'символа нет'
          : 'код переписали после сверки'
        console.log(`  ${anchor.file}${anchor.symbol ? ':' + anchor.symbol : ''} - ${why}`)
      }
    }
    console.log(`расхождений в ${stale.length} документах из ${checked.length}`)
    sayFlow()
    sayUnconfirmed()
    if (stale.some((d) => d.broken.some((b) => b.reason === 'drifted'))) {
      console.log('сверили и документ верен? отметьте: aimd2 logic seal <файл>')
    }
    return 1
  }

  if (action === 'gaps') {
    const dbPath = defaultDbPath(root)
    if (!existsSync(dbPath)) {
      console.error('no scan yet, run: aimd2 scan')
      return 1
    }
    const db = openDb(dbPath)
    const gaps = await findGaps(db, root, 10, docsDir)
    closeDb(db)

    if (gaps.length === 0) {
      console.log('файлов без документа не нашлось')
      return 0
    }

    console.log('На эти файлы не смотрит ни один документ, сверху те, от которых зависит больше всего:')
    for (const gap of gaps) {
      console.log(`  ${gap.file}  импортируют: ${gap.usedBy}, символов: ${gap.symbols}`)
    }
    console.log('Это подсказка, а не требование: документ нужен там, где поведение')
    console.log('не понять из одного файла. Завести: aimd2 logic new "Название"')
    return 0
  }

  if (action === 'trace') {
    const target = args[0]
    if (!target) {
      console.error('нужна точка входа: aimd2 logic trace <файл>:<символ>')
      return 1
    }
    // Двоеточие ищется с конца: в пути диска оно тоже встречается.
    const cut = target.lastIndexOf(':')
    if (cut <= 0 || !target.slice(cut + 1).trim()) {
      console.error('точка входа пишется как файл:символ, например src/order/api.ts:createOrder')
      return 1
    }
    const step: FlowStep = { file: toPosix(target.slice(0, cut)), symbol: target.slice(cut + 1).trim() }

    const depth = values.depth === undefined ? 3 : Number(values.depth)
    if (!Number.isInteger(depth) || depth < 1) {
      console.error(`не глубина: ${values.depth}`)
      return 1
    }

    const dbPath = defaultDbPath(root)
    if (!existsSync(dbPath)) {
      console.error('no scan yet, run: aimd2 scan')
      return 1
    }
    const db = openDb(dbPath)
    const tree = traceCalls(db, step, depth)
    closeDb(db)

    if (!tree) {
      console.error(`символа нет в карте: ${target}`)
      return 1
    }
    printTrace(tree, '')
    if (tree.calls.length === 0) {
      console.log('')
      console.log('Отсюда никто не вызывается. Карта знает только вызовы по имени:')
      console.log('вызов через точку, вроде service.place(), в неё не попадает.')
      return 0
    }
    console.log('')
    console.log('Путь можно записать в шапку документа, и тогда проверка будет следить')
    console.log('не только за телами функций, но и за самими переходами:')
    console.log('# flow: файл:символ -> файл:символ -> файл:символ')
    return 0
  }

  if (action === 'backfill') {
    const dbPath = defaultDbPath(root)
    if (!existsSync(dbPath)) {
      console.error('no scan yet, run: aimd2 scan')
      return 1
    }
    const limit = values.limit === undefined ? 5 : Number(values.limit)
    if (!Number.isInteger(limit) || limit < 1) {
      console.error(`не число связок: ${values.limit}`)
      return 1
    }

    const db = openDb(dbPath)
    try {
      const results = await runBackfill({
        root,
        db,
        sessionId: '',
        model: values.model ?? config.model,
        docsDir,
        limit,
        onStart: (cluster, index, total) =>
          console.log(`[${index}/${total}] ${cluster.seed} (дотягивается до ${cluster.reaches})`),
      })

      if (results.length === 0) {
        console.log('неописанных связок не нашлось')
        return 0
      }
      const written = results.filter((r) => r.action === 'created')
      for (const r of results) {
        if (r.action === 'created') console.log(`  заведён: ${r.path}`)
        else console.log(`  пропущено: ${r.why}`)
      }
      console.log(`заведено документов: ${written.length} из ${results.length} связок`)
      if (written.length > 0) {
        console.log('Это черновики, их никто не читал. Прочитайте и поправьте: aimd2 serve')
      }
      return 0
    } finally {
      closeDb(db)
      await closeRenderer()
    }
  }

  if (action === 'brief') {
    const dbPath = defaultDbPath(root)
    if (!existsSync(dbPath)) {
      console.error('no scan yet, run: aimd2 scan')
      return 1
    }

    const wanted = args.map(toPosix)
    const db = openDb(dbPath)
    const docs = await listDocuments(root, docsDir)

    // Без аргумента берутся только разошедшиеся: сводка нужна для правки, а
    // документ, который сходится, править не за чем.
    const chosen = wanted.length > 0
      ? docs.filter((d) => wanted.some((w) => d.path.endsWith(w)))
      : []

    const briefs = []
    for (const doc of chosen.length > 0 ? chosen : docs) {
      const brief = await buildBrief(db, root, doc)
      if (chosen.length === 0 && !brief.stale) continue
      briefs.push(brief)
    }
    closeDb(db)

    if (briefs.length === 0) {
      console.log(wanted.length > 0 ? `не нашёл документа: ${wanted.join(', ')}` : 'расхождений нет, править нечего')
      return wanted.length > 0 ? 1 : 0
    }

    // Разделитель между сводками, когда их несколько.
    console.log(briefs.map(formatBrief).join(['', '', '---', '', ''].join(String.fromCharCode(10))))
    return 0
  }

  if (action === 'seal') {
    const dbPath = defaultDbPath(root)
    if (!existsSync(dbPath)) {
      console.error('no scan yet, run: aimd2 scan')
      return 1
    }
    // Без аргумента отмечаются все документы: так удобно закрывать разом
    // после крупной правки, когда карту уже пересмотрели целиком.
    const wanted = args.map(toPosix)
    const db = openDb(dbPath)
    const docs = await listDocuments(root, docsDir)
    let sealed = 0

    for (const doc of docs) {
      if (wanted.length > 0 && !wanted.some((w) => doc.path.endsWith(w))) continue
      if (doc.anchors.length === 0) continue

      const next = sealAnchors(db, doc, values.human ? 'human' : 'agent')
      const changed = next.anchors.some((a, i) => a.fingerprint !== doc.anchors[i]?.fingerprint)
      if (!changed) continue

      writeFileSync(resolve(root, doc.path), serializeDocument(next), 'utf8')
      console.log(`сверен ${doc.path}`)
      sealed += 1
    }

    closeDb(db)
    if (wanted.length > 0 && sealed === 0) {
      console.error(`нечего отмечать: ${wanted.join(', ')}`)
      return 1
    }
    console.log(sealed === 0 ? 'все отпечатки уже на месте' : `отмечено документов: ${sealed}`)
    return 0
  }

  console.error(`неизвестное действие: ${action}`)
  return 1
}

/**
 * Точка для хуков ИИ-консолей: событие приходит одним объектом на стандартный
 * вход. Команда ничего не спрашивает и ничего не ломает, она только напоминает
 * про документы, которых коснулась правка.
 */
const CLIS: Cli[] = ['claude', 'codex']

/**
 * Прописывает хуки в настройки ИИ-консоли. Руками этот JSON писать неудобно, а
 * без него сверка работает вхолостую: сигнал есть, но его никто не читает.
 */
async function cmdInit(argv: string[]): Promise<number> {
  const values = parse(argv)
  if (!values) return 1
  const root = resolveRoot(values.path)
  if (!root) return 1

  const asked = values.rest
  const unknown = asked.filter((a) => !CLIS.includes(a as Cli))
  if (unknown.length > 0) {
    console.error(`не знаю такой консоли: ${unknown.join(', ')}. Есть claude и codex.`)
    return 1
  }
  const wanted = asked.length > 0 ? (asked as Cli[]) : CLIS

  for (const cli of wanted) {
    // Испорченный JSON перезаписывать вслепую нельзя: там чужие настройки.
    if (await isBroken(resolve(root, cliTarget(cli)))) {
      console.error(`${cliTarget(cli)} не разбирается как JSON, поправьте его руками`)
      return 1
    }
  }

  for (const cli of wanted) {
    const result = await initCli(root, cli, hookCommand(values.local, fileURLToPath(import.meta.url)))
    console.log(result.unchanged ? `уже настроено: ${result.path}` : `настроено: ${result.path}`)
  }

  // Подсказка только тогда, когда она верна: после свежего скана совет
  // сканировать выглядит как сообщение об ошибке.
  if (!existsSync(defaultDbPath(root))) console.log('карта ещё не построена, начните с aimd2 scan')
  return 0
}

/**
 * Поднимает студию к началу сессии и возвращает её адрес.
 *
 * Живёт в слое команд, а не в ядре хука: ядро зовут тесты, и поднимать там
 * сервер неуместно. Зато так студию получают обе консоли, и настроенная
 * плагином, и прописанная через init.
 *
 * Пустая строка означает "не поднимали и не надо": карты ещё нет, поднимать
 * нечего, или человек отключил это переменной окружения.
 */
async function studioFor(raw: string): Promise<string> {
  if (process.env.AIMD2_BACKGROUND || process.env.AIMD2_NO_STUDIO) return ''

  let event: { hook_event_name?: string; source?: string; cwd?: string }
  try {
    event = JSON.parse(raw) as typeof event
  } catch {
    return ''
  }
  if (event.hook_event_name !== 'SessionStart') return ''
  // clear и compact случаются посреди сессии, студия там уже поднята.
  if (event.source === 'clear' || event.source === 'compact') return ''

  const root = event.cwd ?? process.cwd()
  if (!existsSync(defaultDbPath(root))) return ''

  const config = await loadConfig(root)
  if (!config.studio.autoStart) return ''

  const existing = await readLock(root)
  if (existing && (await aliveAt(existing.url))) return existing.url

  spawn(`aimd2 serve --auto --idle ${config.studio.idleMinutes} --path "${root}"`, {
    shell: true,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AIMD2_BACKGROUND: '1' },
  }).unref()

  // Сервер поднимается не мгновенно, а адрес нужен уже в этом ответе. Ждём
  // недолго и молчим, если не успел: хук не должен задерживать сессию.
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const started = await readLock(root)
    if (started && (await aliveAt(started.url, 400))) return started.url
  }
  return ''
}

async function cmdHook(): Promise<number> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  const reply = await runHook(raw, process.cwd())

  const studio = await studioFor(raw)
  const lines = [reply.text, studio ? `Студия открыта: ${studio}` : ''].filter(Boolean)
  const text = lines.join(String.fromCharCode(10))

  if (text === '') return 0
  if (reply.stream === 'err') console.error(text)
  else console.log(text)
  return reply.code
}

export async function run(argv: string[]): Promise<number> {
  const command = argv[0]
  if (command === 'scan') return cmdScan(argv)
  if (command === 'status') return cmdStatus(argv)
  if (command === 'serve') return cmdServe(argv)
  if (command === 'logic') return cmdLogic(argv)
  if (command === 'hook') return cmdHook()
  if (command === 'init') return cmdInit(argv)
  if (command === 'draft') return cmdDraft(argv)
  if (command === '--version') {
    console.log(PACKAGE_VERSION)
    return 0
  }
  console.log(USAGE)
  return command === '--help' || command === undefined ? 0 : 1
}

/**
 * Запущен ли этот файл напрямую, а не подключён из тестов.
 *
 * Сравнивать argv[1] с import.meta.url в лоб нельзя: npm link кладёт пакет
 * симлинком, и тогда argv[1] это путь ссылки, а import.meta.url уже настоящий
 * путь, потому что узел разрешает ссылки сам. Условие не выполнялось, и
 * поставленный по инструкции из README CLI молча не делал ничего.
 */
export function isDirectLaunch(
  entry: string | undefined,
  moduleUrl: string,
  resolve: (path: string) => string = realpathSync,
): boolean {
  if (entry === undefined) return false
  try {
    return moduleUrl === pathToFileURL(resolve(entry)).href
  } catch {
    // Точки входа может не быть на диске, например при запуске из архива.
    return false
  }
}

if (isDirectLaunch(process.argv[1], import.meta.url)) {
  run(process.argv.slice(2))
    .then((code) => { process.exitCode = code })
    .catch((error: unknown) => {
      // Без этого любая неперехваченная ошибка доходила бы до пользователя
      // сырым стектрейсом узлов node:internal.
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
