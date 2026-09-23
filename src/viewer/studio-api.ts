import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { parseDocument, serializeDocument, type DocStatus } from '../logic/document.js'
import {
  sealAnchors,
  checkLibrary,
  neighbourFiles,
  shownStatus,
  DEFAULT_DOCS_DIR,
  type CheckedDocument,
} from '../logic/library.js'
import { renderDiagram, type RenderResult, type Layout, type Appearance } from '../logic/render.js'
import { checkFlow, type FlowIssue } from '../logic/flow.js'
import { toPosix } from '../graph/ids.js'

export interface LibraryEntry {
  path: string
  title: string
  status: DocStatus
  area: string
  summary: string
  updated: string
  anchors: number
  broken: number
  drifted: number
  /** Кто сверял документ с кодом: agent, human или никто. */
  checkedBy: 'agent' | 'human' | ''
}

export interface LibraryView {
  root: string
  docsDir: string
  entries: LibraryEntry[]
  areas: string[]
}

function toEntry(doc: CheckedDocument): LibraryEntry {
  return {
    path: doc.path,
    title: doc.title,
    // Статус показывается производный: подтверждение человека перестаёт
    // действовать, когда код под якорем переписали.
    status: shownStatus(doc, doc.broken),
    area: doc.area,
    summary: doc.summary,
    updated: doc.updated,
    anchors: doc.anchors.length,
    // Исчезнувший код и переписанный это разные новости, и в списке они
    // показываются по-разному: первое ломает документ, второе просит перечитать.
    broken: doc.broken.filter((b) => b.reason !== 'drifted').length,
    drifted: doc.broken.filter((b) => b.reason === 'drifted').length,
    checkedBy: doc.checked?.by ?? '',
  }
}

export async function libraryView(db: DatabaseSync, root: string): Promise<LibraryView> {
  const checked = await checkLibrary(db, root)
  const areas = [...new Set(checked.map((d) => d.area).filter((a) => a !== ''))].sort()
  // Корень приходит с разделителями своей системы, а пути документов всегда
  // через косую черту. В одной строке это выглядело как D:\project/docs/logic.
  return { root: toPosix(root), docsDir: DEFAULT_DOCS_DIR, entries: checked.map(toEntry), areas }
}

export interface DocumentView {
  document: ReturnType<typeof parseDocument>
  broken: CheckedDocument['broken']
  /** Что не сошлось в описанном ходе. Пусто, если хода нет или он цел. */
  flow: FlowIssue[]
  render: RenderResult
}

export async function documentView(
  db: DatabaseSync,
  root: string,
  path: string,
  layout: Layout,
  appearance: Appearance = 'dark',
  /** Какую доску документа рисовать. Пусто это корень. */
  target = '',
): Promise<DocumentView> {
  const source = await readFile(join(root, path), 'utf8')
  const document = parseDocument(path, source)
  const checked = await checkLibrary(db, root)
  const broken = checked.find((d) => d.path === document.path)?.broken ?? []
  const neighbours = await neighbourFiles(root)
  return {
    document,
    broken,
    flow: document.flow.length > 0 ? checkFlow(db, document.flow) : [],
    render: await renderDiagram(document.body, layout, appearance, neighbours, target),
  }
}

export interface SaveRequest {
  path: string
  body?: string
  status?: DocStatus
  title?: string
  area?: string
  summary?: string
}

/**
 * Пишет документ на диск. Дата обновления ставится автоматически: держать её
 * в актуальном состоянии руками никто не будет.
 */
/**
 * Отметка человека о том, что он сверил документ с кодом. Отдельно от
 * сохранения: сохранение это часто правка описания, и молча выдавать её за
 * прочтение кода значит гасить единственный сигнал доверия.
 */
export async function confirmDocument(db: DatabaseSync, root: string, path: string): Promise<void> {
  const source = await readFile(join(root, path), 'utf8')
  const doc = parseDocument(path, source)
  await writeFile(join(root, path), serializeDocument(sealAnchors(db, doc, 'human')), 'utf8')
}

export async function saveDocument(root: string, request: SaveRequest): Promise<void> {
  const target = join(root, request.path)
  let existing = ''
  try {
    existing = await readFile(target, 'utf8')
  } catch {
    // Новый документ, шапка соберётся из переданных полей.
  }

  const doc = parseDocument(request.path, existing)
  const updated = {
    ...doc,
    title: request.title ?? doc.title,
    area: request.area ?? doc.area,
    summary: request.summary ?? doc.summary,
    status: request.status ?? doc.status,
    body: request.body ?? doc.body,
    updated: new Date().toISOString().slice(0, 10),
  }

  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, serializeDocument(updated), 'utf8')
}
