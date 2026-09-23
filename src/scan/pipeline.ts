import { readFile, stat } from 'node:fs/promises'
import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { openDb, closeDb } from '../store/db.js'
import { startSession, endSession } from '../store/sessions.js'
import { upsertNode, markNodesRemoved, findSymbolNode } from '../store/nodes.js'
import { replaceEdgesFrom } from '../store/edges.js'
import { symbolNodeId } from '../graph/ids.js'
import type { GraphEdge, GraphNode } from '../graph/types.js'
import { walkFiles } from './walk.js'
import { hashContent } from './hash.js'
import { languageForPath } from './grammars.js'
import { extractOutline, normalizeBody, type CallSite } from './symbols.js'
import { extractImports, resolveImport, type ImportBinding } from './imports.js'
import {
  diffFiles,
  recordFiles,
  forgetFiles,
  nodeIdsForFiles,
  extractorMatches,
  type FileState,
} from './incremental.js'
import { EXTRACTOR_VERSION } from '../store/schema.js'
import { loadConfig, type ProjectConfig } from '../logic/config.js'

export interface ScanResult {
  filesScanned: number
  filesSkipped: number
  /** Файлы, которые не удалось прочитать или разобрать: скан из-за них не прерывается. */
  filesFailed: number
  /**
   * Первый сбой со своей причиной. Счётчик без причины не отличает пропавший
   * файл от отказавшей записи в базу, а вызывающий обязан такой скан считать
   * неуспешным.
   */
  firstFailure: { path: string; message: string } | null
  nodesCreated: number
  nodesUpdated: number
  nodesRemoved: number
  /** Число строк, реально записанных в таблицу edges: дубликаты импортов его не увеличивают. */
  edgesWritten: number
}

export async function estimateScan(
  root: string,
  config?: ProjectConfig,
): Promise<{ files: number; byLanguage: Record<string, number> }> {
  const files = await walkFiles(root, config ?? (await loadConfig(root)))
  const byLanguage: Record<string, number> = {}
  for (const f of files) {
    const lang = languageForPath(f) ?? 'unknown'
    byLanguage[lang] = (byLanguage[lang] ?? 0) + 1
  }
  return { files: files.length, byLanguage }
}

function moduleNode(relPath: string, content: string): GraphNode {
  return {
    id: symbolNodeId(relPath, '', 'module'),
    kind: 'module',
    layer: 'structure',
    title: relPath,
    summary: null,
    status: 'implemented',
    source: 'parser',
    confidence: 1,
    clusterId: null,
    symbolKind: null,
    // Якорь на файл целиком сверяется по его тексту: символа, тело которого
    // можно было бы взять, у такого якоря нет.
    bodyHash: content === '' ? null : hashContent(normalizeBody(content)),
    anchors: [{ file: relPath, symbol: '', startLine: 1, endLine: 1, commit: null }],
  }
}

/**
 * Вызовы одного файла, отложенные до конца скана.
 *
 * Разрешить их сразу нельзя: вызов уходит в другой файл, а тот на этот момент
 * может быть ещё не разобран, и его символа в базе нет. Второй проход идёт
 * по уже записанным узлам и потому видит весь проект целиком.
 */
interface PendingCalls {
  rel: string
  calls: CallSite[]
  bindings: ImportBinding[]
  /** Узлы файла: у каждого чистятся прежние рёбра вызовов, даже если новых нет. */
  nodeIds: string[]
  /** Пути символов, объявленных здесь же: вызов соседа по файлу импорта не требует. */
  own: Set<string>
}

function writeCallEdges(db: DatabaseSync, pending: PendingCalls[], known: Set<string>): number {
  let written = 0

  for (const file of pending) {
    const imported = new Map<string, { file: string; symbol: string }>()
    for (const b of file.bindings) {
      const target = resolveImport(file.rel, b.specifier, known)
      if (target) imported.set(b.local, { file: target, symbol: b.imported })
    }

    // Пустые списки заведены заранее: файл мог перестать кого-то звать, и без
    // явной замены прежнее ребро осталось бы в карте навсегда.
    const byFrom = new Map<string, GraphEdge[]>(file.nodeIds.map((id) => [id, []]))

    for (const call of file.calls) {
      const target =
        imported.get(call.callee) ?? (file.own.has(call.callee) ? { file: file.rel, symbol: call.callee } : null)
      if (!target) continue

      const to = findSymbolNode(db, target.file, target.symbol)
      if (!to) continue
      const from = call.from === '' ? symbolNodeId(file.rel, '', 'module') : findSymbolNode(db, file.rel, call.from)
      // Рекурсия это настоящий вызов, но в цепочке шагов петля ничего не
      // добавляет, а читается как ошибка разбора.
      if (!from || from === to) continue

      // Уверенность единица, потому что неоднозначное сюда не доходит вовсе:
      // и имя, и файл разрешены точно, а всё спорное отброшено выше.
      byFrom.get(from)?.push({ from, to, kind: 'calls', source: 'parser', confidence: 1 })
    }

    for (const [from, edges] of byFrom) written += replaceEdgesFrom(db, from, 'calls', edges)
  }
  return written
}

function noteFailure(result: ScanResult, path: string, error: unknown): void {
  result.filesFailed += 1
  // Запоминается первый: он ближе всего к причине, последующие обычно её следствия.
  result.firstFailure ??= { path, message: error instanceof Error ? error.message : String(error) }
}

export async function scanProject(opts: {
  root: string
  dbPath: string
  agent?: string
  config?: ProjectConfig
}): Promise<ScanResult> {
  const { root, dbPath } = opts
  const config = opts.config ?? (await loadConfig(root))
  const db = openDb(dbPath)
  // session начинается внутри try, чтобы падение startSession тоже закрывало
  // db в finally, а не оставляло соединение висеть.
  let session: string | null = null

  const result: ScanResult = {
    filesScanned: 0, filesSkipped: 0, filesFailed: 0, firstFailure: null,
    nodesCreated: 0, nodesUpdated: 0, nodesRemoved: 0, edgesWritten: 0,
  }

  try {
    session = startSession(db, { agent: opts.agent ?? 'scan' })
    const paths = await walkFiles(root, config)
    const states: FileState[] = []

    for (const rel of paths) {
      // Каждый файл обёрнут отдельно: между обходом и чтением файл могли
      // удалить или заблокировать, и один такой файл ронял весь скан.
      try {
        const abs = join(root, rel)
        const info = await stat(abs)
        const language = languageForPath(rel)
        // Файл неизвестного языка не читается вовсе: разбирать в нём нечего, а
        // прочитать как utf8 пришлось бы и мегабайтные wasm грамматики. Размер
        // и время правки меняются при любой записи, так что diffFiles заметит
        // изменение и такого файла.
        states.push({
          path: rel,
          hash: language ? hashContent(await readFile(abs, 'utf8')) : hashContent(`${info.size}:${info.mtimeMs}`),
          language: language ?? 'unknown',
          size: info.size,
        })
      } catch (error) {
        noteFailure(result, rel, error)
      }
    }

    // Правила разбора изменились: содержимое файлов прежнее, а извлекать из
    // него надо другое, и по хешу скан счёл бы их неизменившимися.
    const fresh = extractorMatches(db, EXTRACTOR_VERSION)
    if (!fresh) forgetFiles(db, states.map((s) => s.path))

    const delta = diffFiles(db, states)
    result.filesSkipped = delta.unchanged.length

    if (delta.removed.length > 0) {
      result.nodesRemoved = markNodesRemoved(db, nodeIdsForFiles(db, delta.removed), session)
      forgetFiles(db, delta.removed)
    }

    const known = new Set(paths)
    const failed = new Set<string>()
    const pending: PendingCalls[] = []

    for (const rel of delta.changed) {
      try {
        const calls = await scanFile(db, root, rel, known, session, result)
        if (calls) pending.push(calls)
      } catch (error) {
        // Сбой на одном файле не отменяет уже разобранные: файл просто не
        // попадёт в files и будет разобран заново на следующем скане. Причина
        // сохраняется: под этот catch попадает и отказ самой базы, а молча
        // записать его в счётчик значило бы соврать об успехе.
        failed.add(rel)
        noteFailure(result, rel, error)
      }
    }

    result.edgesWritten += writeCallEdges(db, pending, known)

    // Файл, на котором сорвался разбор, не разобран: считать его и там, и там
    // значит печатать отчёт, противоречащий сам себе.
    result.filesScanned = delta.changed.length - failed.size
    const changedPaths = new Set(delta.changed.filter((p) => !failed.has(p)))
    recordFiles(db, states.filter((s) => changedPaths.has(s.path)))
    return result
  } finally {
    if (session) endSession(db, session)
    closeDb(db)
  }
}

async function scanFile(
  db: DatabaseSync,
  root: string,
  rel: string,
  known: Set<string>,
  session: string,
  result: ScanResult,
): Promise<PendingCalls | null> {
  const language = languageForPath(rel)
  // Содержимое читается здесь, а не копится в общей карте на весь скан: в
  // памяти живёт ровно один файл, а не весь репозиторий.
  const content = language ? await readFile(join(root, rel), 'utf8') : ''

  const outline = language ? await extractOutline(content, language) : { symbols: [], calls: [] }
  const nodes: GraphNode[] = [moduleNode(rel, content)]

  for (const sym of outline.symbols) {
    nodes.push({
      // Вид входит в идентификатор: класс и интерфейс с одним именем в одном
      // файле это разные сущности, а путь символа у них совпадает.
      id: symbolNodeId(rel, sym.symbolPath, `symbol:${sym.kind}`),
      kind: 'symbol',
      layer: 'structure',
      title: sym.name,
      summary: null,
      status: 'implemented',
      source: 'parser',
      confidence: 1,
      clusterId: null,
      symbolKind: sym.kind,
      bodyHash: sym.bodyHash,
      anchors: [{ file: rel, symbol: sym.symbolPath, startLine: sym.startLine, endLine: sym.endLine, commit: null }],
    })
  }

  // Символы, пропавшие из оставшегося файла, иначе никто не тронет: в
  // delta.removed попадают только исчезнувшие файлы целиком, и узел
  // удалённой функции навсегда остался бы реализованным.
  const fresh = new Set(nodes.map((n) => n.id))
  const stale = nodeIdsForFiles(db, [rel]).filter((id) => !fresh.has(id))
  result.nodesRemoved += markNodesRemoved(db, stale, session)

  for (const node of nodes) {
    const outcome = upsertNode(db, node, session)
    if (outcome === 'created') result.nodesCreated += 1
    else if (outcome === 'updated') result.nodesUpdated += 1
  }

  if (!language) return null

  const { specifiers, bindings } = await extractImports(content, language)
  const edges: GraphEdge[] = []
  for (const spec of specifiers) {
    const target = resolveImport(rel, spec, known)
    if (!target) continue
    edges.push({
      from: symbolNodeId(rel, '', 'module'),
      to: symbolNodeId(target, '', 'module'),
      kind: 'imports',
      source: 'parser',
      confidence: 1,
    })
  }
  // Считается то, что легло в таблицу: два одинаковых импорта в одном
  // файле дают одну строку по первичному ключу, и счётчик по длине списка
  // расходился с тем, что потом показывает status.
  result.edgesWritten += replaceEdgesFrom(db, symbolNodeId(rel, '', 'module'), 'imports', edges)

  return {
    rel,
    calls: outline.calls,
    bindings,
    nodeIds: nodes.map((n) => n.id),
    own: new Set(outline.symbols.map((s) => s.symbolPath)),
  }
}
