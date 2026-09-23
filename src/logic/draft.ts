import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { listDocuments, neighbourFiles, DEFAULT_DOCS_DIR } from './library.js'
import { parseDocument, serializeDocument, type LogicDocument } from './document.js'
import { parseFlow, type FlowStep } from './flow.js'
import { buildBrief, formatBrief } from './brief.js'
import { readPalette } from './palette.js'
import { ensurePalette } from './palette-template.js'
import { renderDiagram, closeRenderer } from './render.js'
import { findSymbolNode } from '../store/nodes.js'
import { findTranscript, readLastTurn, type Turn } from './transcript.js'
import { languageForPath } from '../scan/grammars.js'

export interface DraftOptions {
  root: string
  sessionId: string
  model: string
  db: DatabaseSync
  docsDir?: string
}

export interface DraftResult {
  action: 'skipped' | 'updated' | 'created'
  /** Путь документа, если он написан. */
  path?: string
  /** Почему ничего не вышло. Пишется в отчёт, наружу не всплывает. */
  why?: string
}

const SEPARATOR = '---'
const NEWLINE = String.fromCharCode(10)
const MAX_CODE = 6000

// Имя модели приходит флагом и уезжает в строку команды. Проверка обязательна:
// без неё в аргумент можно было бы подставить что угодно.
const MODEL = /^[\w.:-]+$/

function skip(why: string): DraftResult {
  return { action: 'skipped', why }
}

/**
 * Ответ модели: заголовок из пар "КЛЮЧ: значение" и тело за строкой с тремя
 * дефисами.
 *
 * Исходов три, а не два, и различать их обязательно. Осознанный отказ это
 * нормальная работа: не всякая связка кода заслуживает документа. Ответ, не
 * подошедший под формат, это поломка. Свалив их в одну кучу, мы перестали бы
 * отличать модель, которой нечего сказать, от модели, которая перестала
 * соблюдать уговор.
 */
export type Reply =
  | { kind: 'ok'; head: Map<string, string>; body: string }
  | { kind: 'skip' }
  | { kind: 'unparsed'; head: string }

export function parseReply(raw: string): Reply {
  const text = raw.trim()
  const firstLine = () => text.split(NEWLINE)[0]?.slice(0, 80) ?? ''
  if (!text) return { kind: 'unparsed', head: '(пустой ответ)' }
  if (text.startsWith('SKIP')) return { kind: 'skip' }

  const cut = text.indexOf(NEWLINE + SEPARATOR)
  if (cut < 0) return { kind: 'unparsed', head: firstLine() }

  const head = new Map<string, string>()
  for (const line of text.slice(0, cut).split(NEWLINE)) {
    const match = /^([A-Z]+)\s*:\s*(.*)$/.exec(line.trim())
    if (match) head.set(match[1] as string, (match[2] ?? '').trim())
  }
  const body = text.slice(cut + SEPARATOR.length + 1).replace(/^\s+/, '')
  return body.trim() ? { kind: 'ok', head, body } : { kind: 'unparsed', head: firstLine() }
}

function palettePrompt(classes: { name: string; hint: string; group: string }[]): string {
  if (classes.length === 0) return ''
  const lines = classes.map((c) => `  ${c.name}: ${c.hint || c.group}`)
  return `Роли задаются только этими классами, свои цвета писать нельзя:\n${lines.join('\n')}`
}

const RULES = [
  'Ты пишешь документ логики на языке D2. Правила жёсткие:',
  '- документ отвечает на вопрос "как система себя ведёт и почему", а не пересказывает код построчно;',
  '- первой строкой тела всегда идёт ...@_palette;',
  '- роль узла задаётся классом из палитры, свой цвет писать нельзя;',
  '- никаких статусов approved и никаких отметок о сверке: это не твоё дело;',
  '- описание это рассказ о поведении, а не запись в журнале изменений:',
  '  "Тринадцать кодов жизненного цикла и кто их двигает" это описание,',
  '  "Добавлена проверка подписи" и "Теперь работает быстрее" это не описание;',
  '- одна тема на документ: название вроде "Что-то и ещё что-то" значит, что тем две,',
  '  и тогда опиши главную, а про вторую промолчи;',
  '- подписи узлов пишутся одной строкой: последовательность из обратного слэша и n',
  '  в D2 переносом не считается и покажется как есть;',
  '- классы async, error, data и weak вешаются только на связи, не на узлы;',
  '- у развилки сначала объявляй продолжение, а потом тупик: раскладчик ведёт',
  '  основную линию по первой связи, и так цепочка условий встаёт прямым столбцом;',
  '- объяснение вешается на узел полем tooltip, а не блоком текста на полотне:',
  '  блок в несколько абзацев растягивает раскладку, и схему становится не прочесть;',
  '  класс note оставляй под одну короткую строку;',
  '- ответ присылай как есть, без markdown-забора из обратных кавычек;',
  '- если писать нечего или изменение не меняет описанное поведение, ответь одним словом SKIP.',
  '',
  // Пример весомее правил: без него модель выдумывает свой синтаксис, пишет
  // роль словом перед именем узла, и документ компилируется, но читается не так.
  'Вот правильное тело документа целиком, держись этой формы:',
  '',
  '...@_palette',
  '',
  'direction: right',
  '',
  'client: Клиент { class: actor }',
  'check: Подпись верна? {',
  '  class: choice',
  '  tooltip: "Почему именно так, одним-двумя предложениями."',
  '}',
  'db: Заявки { class: store }',
  'reject: Отказ { class: danger }',
  '',
  'client -> check: подаёт заявку',
  'check -> db: да { class: data }',
  'check -> reject: нет { class: error }',
  '',
  'note: |md',
  '  **Почему так**',
  '',
  '  Пояснение сбоку, это не шаг.',
  '| { class: note }',
].join(NEWLINE)

function replyFormat(isNew: boolean): string {
  const fields = isNew
    ? ['TITLE: название про поведение, а не про функцию', 'AREA: одно слово, область системы', 'SUMMARY: одно-два предложения, по ним одним должно быть понятно содержание', 'ANCHORS: файл:символ, файл:символ', 'FLOW: файл:символ -> файл:символ  (только если важен порядок, иначе строку опусти)']
    : ['SUMMARY: одно-два предложения (только если старое описание разошлось, иначе строку опусти)', 'FLOW: файл:символ -> файл:символ  (только если важен порядок, иначе строку опусти)']
  return ['Ответ строго в таком виде:', ...fields, SEPARATOR, '<тело документа на D2>'].join('\n')
}

async function excerpt(root: string, files: string[]): Promise<string> {
  const parts: string[] = []
  let left = MAX_CODE
  for (const file of files) {
    if (left <= 0) break
    try {
      const text = await readFile(join(root, file), 'utf8')
      const cut = text.length > left ? `${text.slice(0, left)}\n...` : text
      left -= cut.length
      parts.push(`### ${file}\n\n\`\`\`\n${cut}\n\`\`\``)
    } catch {
      // Файл могли удалить между ходом и запуском: это не повод бросать работу.
    }
  }
  return parts.join('\n\n')
}

/**
 * Зовёт дешёвую модель через ту же консоль, которой пользуется человек.
 *
 * Так не нужен отдельный ключ: берётся уже имеющаяся авторизация. Запущенная
 * сессия сама сработала бы по хукам и позвала бы себя заново, поэтому в
 * окружение ставится метка, по которой хуки молча выходят.
 */
async function ask(prompt: string, model: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(`claude -p --model ${model}`, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, AIMD2_BACKGROUND: '1' },
    })

    let out = ''
    let done = false
    const finish = (value: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      child.kill()
      finish(null)
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      out += chunk
    })
    // Поток ошибок читается и выбрасывается: без чтения буфер трубы заполнится
    // и ребёнок встанет насмерть.
    child.stderr.on('data', () => {})
    child.on('error', () => finish(null))
    child.stdin.on('error', () => finish(null))
    child.on('close', (code) => finish(code === 0 ? out : null))

    child.stdin.end(prompt)
  })
}

/** Тело всегда подключает палитру: без неё документ не соберётся. */
/**
 * Тело с ровно одним верным подключением палитры.
 *
 * Строка импорта выкидывается и пишется заново, а не проверяется на наличие:
 * модель регулярно промахивается с числом точек, а раньше при промахе мы
 * дописывали верную строку сверху, не убрав сломанную, и документ не
 * собирался из-за оставшегося мусора.
 */
function withPalette(body: string): string {
  const text = fenceless(body)
    .split(NEWLINE)
    .filter((line) => !/^\.*@_palette\s*$/.test(line.trim()))
    .join(NEWLINE)
    .trim()
  return `...@_palette${NEWLINE}${NEWLINE}${text}${NEWLINE}`
}

/**
 * Снимает markdown-забор, в который модель иногда заворачивает ответ.
 *
 * Без этого забор остаётся в теле документа, а проверка компиляции его не
 * ловит: D2 разбирает три обратные кавычки как обычный узел и не считает это
 * ошибкой. На схеме потом висит мусорный прямоугольник с именем из кавычек.
 */
function fenceless(body: string): string {
  // Пара из обратного слэша и n переносом в D2 не считается и показывается
  // как есть. Модели пишут её по привычке из других языков разметки, и
  // просьбы в подсказке помогают не всегда, поэтому чиним молча.
  const text = body.split(String.fromCharCode(92) + 'n').join(' ').trim()
  const fence = /^```[a-zA-Z0-9]*\s*\r?\n([\s\S]*?)\r?\n```\s*$/.exec(text)
  return (fence?.[1] ?? text).trim()
}

/** Пусто, если документ собрался, иначе первая ошибка компилятора. */
async function compileError(root: string, body: string, docsDir: string): Promise<string> {
  const result = await renderDiagram(body, 'dagre', 'dark', await neighbourFiles(root, docsDir))
  if (result.ok) return ''
  const first = result.errors[0]
  return first ? `строка ${first.line}: ${first.message}` : 'не собрался'
}

/**
 * Шаги хода, которые действительно есть в карте.
 *
 * Модель охотно пишет пути на глаз: имя файла без каталога, расширение .js
 * вместо .ts, символ, которого нет. Якоря так уже проверяются, а ход
 * проверять было нечем, и в шапку уезжала выдумка, которую потом нечем сверить.
 */
function keepKnownSteps(steps: FlowStep[], db: DatabaseSync): FlowStep[] {
  return steps.filter((step) => findSymbolNode(db, step.file, step.symbol) !== null)
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Стоит ли заводить новый документ.
 *
 * Порог нарочно строгий. Документ на каждую правку превратил бы библиотеку в
 * свалку, которую никто не читает, а это ровно то состояние, из которого
 * инструмент и должен выводить. Признак поведения, достойного документа: правка
 * прошла по нескольким файлам, и эти файлы связаны вызовами, то есть они части
 * одного хода, а не независимые мелочи.
 */
function worthNewDocument(db: DatabaseSync, files: string[]): boolean {
  const code = files.filter((f) => languageForPath(f) !== null)
  if (code.length < 2) return false

  const ids = new Map<string, string[]>()
  for (const file of code) {
    const rows = db
      .prepare(
        `SELECT a.node_id AS id FROM anchors a JOIN nodes n ON n.id = a.node_id
         WHERE a.file = ? AND a.symbol <> '' AND n.status <> 'removed'`,
      )
      .all(file) as { id: string }[]
    ids.set(file, rows.map((r) => r.id))
  }

  for (const [file, from] of ids) {
    for (const [other, to] of ids) {
      if (file === other || from.length === 0 || to.length === 0) continue
      const row = db
        .prepare(
          `SELECT 1 AS ok FROM edges WHERE kind = 'calls'
           AND from_id IN (${from.map(() => '?').join(',')})
           AND to_id IN (${to.map(() => '?').join(',')}) LIMIT 1`,
        )
        .get(...from, ...to) as { ok: number } | undefined
      if (row) return true
    }
  }
  return false
}


export interface Cluster {
  /** Файл, вокруг которого собрана связка. */
  seed: string
  /** Он и файлы, до которых он дотягивается вызовами. */
  files: string[]
  /** До скольких чужих файлов дотягивается: чем больше, тем вероятнее тут ход. */
  reaches: number
}

/**
 * Связки кода, которые никем не описаны, сверху самые похожие на поведение.
 *
 * Отбор идёт не так, как у gaps. Там наверху оказывается то, что все
 * импортируют, а это обычно водопровод: подключение к базе, общий модуль,
 * реестр. Здесь наверху то, чьи функции зовут функции из нескольких чужих
 * файлов, то есть места, где ход собирается воедино. Документ нужен именно там.
 */
export async function findClusters(
  db: DatabaseSync,
  root: string,
  limit: number,
  docsDir = DEFAULT_DOCS_DIR,
): Promise<Cluster[]> {
  const docs = await listDocuments(root, docsDir)
  const covered = new Set(docs.flatMap((d) => d.anchors.map((a) => a.file)))

  const rows = db
    .prepare(
      // Выбывшие узлы отсекаются на обоих концах. Рёбра переживают уход
      // файла из карты: их никто не переписывает, пока сам файл не
      // пересканируют, а после сужения настроек этого и не случится. Без
      // фильтра сбор предлагал бы документы про код, который человек из карты
      // только что убрал.
      `SELECT src.file AS file, count(DISTINCT dst.file) AS reaches
       FROM edges e
       JOIN anchors src ON src.node_id = e.from_id
       JOIN nodes sn ON sn.id = e.from_id AND sn.status <> 'removed'
       JOIN anchors dst ON dst.node_id = e.to_id
       JOIN nodes dn ON dn.id = e.to_id AND dn.status <> 'removed'
       WHERE e.kind = 'calls' AND src.file <> dst.file
       GROUP BY src.file
       HAVING reaches > 1
       ORDER BY reaches DESC, src.file`,
    )
    .all() as { file: string; reaches: number }[]

  const out: Cluster[] = []
  for (const row of rows) {
    if (out.length >= limit) break
    if (covered.has(row.file)) continue

    const targets = db
      .prepare(
        `SELECT DISTINCT dst.file AS file
         FROM edges e
         JOIN anchors src ON src.node_id = e.from_id
         JOIN anchors dst ON dst.node_id = e.to_id
         JOIN nodes dn ON dn.id = e.to_id AND dn.status <> 'removed'
         WHERE e.kind = 'calls' AND src.file = ? AND dst.file <> ?
         ORDER BY dst.file LIMIT 3`,
      )
      .all(row.file, row.file) as { file: string }[]

    // Уже описанный сосед в связку не тянется: документ про него есть, и
    // второй, повторяющий то же самое, библиотеке только вредит.
    const files = [row.file, ...targets.map((t) => t.file).filter((f) => !covered.has(f))]
    out.push({ seed: row.file, files, reaches: row.reaches })
  }
  return out
}

export interface BackfillResult extends DraftResult {
  cluster: Cluster
}

/**
 * Проходит по неописанным связкам и пишет документы.
 *
 * Разом по всему проекту не ходит и по умолчанию берёт немного: каждая связка
 * это обращение к модели, и полторы тысячи обращений на большом репозитории
 * никому не нужны. Заодно это защита от свалки: десять документов, которые
 * человек прочитает, полезнее сотни, которые он не откроет.
 */
export async function runBackfill(
  opts: DraftOptions & { limit: number; onStart?: (cluster: Cluster, index: number, total: number) => void },
): Promise<BackfillResult[]> {
  const docsDir = opts.docsDir ?? DEFAULT_DOCS_DIR
  const results: BackfillResult[] = []
  if (!MODEL.test(opts.model)) return results

  // Палитра нужна до первого документа: тело подключает её строкой с тремя
  // точками, и без файла рядом ни один черновик не скомпилируется, а значит
  // все они будут забракованы проверкой и выброшены.
  await ensurePalette(opts.root, docsDir)

  const palette = palettePrompt(await readPalette(opts.root, docsDir))
  const clusters = await findClusters(opts.db, opts.root, opts.limit, docsDir)

  for (const [index, cluster] of clusters.entries()) {
    opts.onStart?.(cluster, index + 1, clusters.length)
    const code = await excerpt(opts.root, cluster.files)
    const written = await writeNewDocument(opts, docsDir, code, 'Это связка файлов, которые зовут друг друга.', palette)
    results.push({ cluster, ...written })
  }
  return results
}

export async function runDraft(opts: DraftOptions): Promise<DraftResult> {
  const { root, db, model } = opts
  const docsDir = opts.docsDir ?? DEFAULT_DOCS_DIR
  if (!MODEL.test(model)) return skip(`не имя модели: ${model}`)

  const transcript = await findTranscript(opts.sessionId)
  if (!transcript) return skip('записи сессии нет')

  const turn: Turn = await readLastTurn(transcript, root)
  if (turn.files.length === 0) return skip('в этом заходе код не правили')

  const docs = await listDocuments(root, docsDir)
  const touched = new Set(turn.files)
  const target = docs.find((d) => d.anchors.some((a) => touched.has(a.file)))

  const palette = palettePrompt(await readPalette(root, docsDir))

  if (target) {
    // Подтверждённое человеком не трогается ни при каких условиях: его слово
    // не может быть переписано фоновой моделью.
    if (target.status === 'approved') return skip(`документ подтверждён человеком: ${target.path}`)
    return await updateDocument(opts, docsDir, target, turn, palette)
  }

  if (!worthNewDocument(db, turn.files)) return skip('правка не тянет на отдельный документ')
  await ensurePalette(root, docsDir)
  return await createDocument(opts, docsDir, turn, palette)
}

async function updateDocument(
  opts: DraftOptions,
  docsDir: string,
  doc: LogicDocument,
  turn: Turn,
  palette: string,
): Promise<DraftResult> {
  const brief = formatBrief(await buildBrief(opts.db, opts.root, doc))
  const prompt = [
    RULES,
    palette,
    'Вот документ и код, на который он опирается сейчас:',
    brief,
    'А вот что происходило в работе, включая рассуждения:',
    turn.text,
    'Обнови документ, если описанное поведение изменилось. Заголовок и якоря оставь как есть.',
    replyFormat(false),
  ]
    .filter(Boolean)
    .join('\n\n')

  const reply = await ask(prompt, opts.model, 180_000)
  if (!reply) return skip('модель не ответила')
  const parsed = parseReply(reply)
  if (parsed.kind === 'skip') return skip('модель решила, что править нечего')
  if (parsed.kind === 'unparsed') return skip(`ответ не разобрался: ${parsed.head}`)

  const body = await settle(opts, docsDir, prompt, parsed)
  if (typeof body !== 'string') return body

  const flow = parsed.head.get('FLOW')
  const next: LogicDocument = {
    ...doc,
    // Описание заполняется только пустое. Переписывать существующее фоновой
    // модели нельзя: его видно в списке, по нему часто дальше не читают, и
    // замена рассказа о поведении на запись вида "добавлено то-то" портит
    // библиотеку заметнее, чем любая ошибка в теле диаграммы. Разошедшееся
    // описание всплывёт сверкой, и поправит его тот, кто читал код.
    summary: doc.summary || parsed.head.get('SUMMARY') || '',
    updated: today(),
    flow: flow ? keepKnownSteps(parseFlow(flow), opts.db) : doc.flow,
    // Отметка о сверке намеренно не ставится. Переписать текст и заявить, что
    // он сверен с кодом, это два разных действия, и второе стоит ровно
    // столько, сколько внимательность того, кто его сделал.
    body,
  }
  await writeFile(join(opts.root, doc.path), serializeDocument(next), 'utf8')
  return { action: 'updated', path: doc.path }
}

/**
 * Доводит тело до собирающегося состояния: одна попытка исправиться.
 *
 * Показать модели текст компилятора дешевле, чем выбросить работу: свою
 * опечатку она чинит почти всегда. Второго круга нет намеренно, потому что
 * повторная ошибка это уже не опечатка, а непонимание задачи, и уговоры тут
 * только жгут деньги.
 *
 * Возвращает тело или готовый отказ, если ничего не вышло.
 */
async function settle(
  opts: DraftOptions,
  docsDir: string,
  prompt: string,
  parsed: Extract<Reply, { kind: 'ok' }>,
): Promise<string | DraftResult> {
  let body = withPalette(parsed.body)
  let error = await compileError(opts.root, body, docsDir)
  if (!error) return body

  const again = await ask(
    [prompt, 'Твой ответ не собрался. Вот что сказал компилятор D2:', error, 'Пришли исправленный ответ в том же виде.'].join(
      NEWLINE + NEWLINE,
    ),
    opts.model,
    180_000,
  )
  if (again) {
    const second = parseReply(again)
    if (second.kind === 'ok') {
      const fixed = withPalette(second.body)
      const still = await compileError(opts.root, fixed, docsDir)
      if (!still) {
        parsed.head = second.head
        return fixed
      }
      error = still
    }
  }
  return skip(`черновик не собрался: ${error}`)
}

function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    // Длинное имя неудобно всем: в списке файлов, в git diff, в ссылке. Режем
    // по границе слова, чтобы не обрывать посередине.
    .replace(/^(.{0,48})(-.*)?$/u, '$1')
    .replace(/-+$/, '')
  return `${slug || 'документ'}.d2`
}

async function createDocument(
  opts: DraftOptions,
  docsDir: string,
  turn: Turn,
  palette: string,
): Promise<DraftResult> {
  const code = await excerpt(opts.root, turn.files)
  const context = ['А вот что происходило в работе, включая рассуждения:', turn.text].join(NEWLINE + NEWLINE)
  return await writeNewDocument(opts, docsDir, code, context, palette)
}

/**
 * Пишет новый документ по куску кода и обстоятельствам.
 *
 * Одна дорога на два случая: по ходу сессии обстоятельства это переписка с
 * рассуждениями, при сборе по проекту это просто указание, что файлы связаны
 * вызовами. Всё остальное, включая право модели отказаться, одинаково.
 */
async function writeNewDocument(
  opts: DraftOptions,
  docsDir: string,
  code: string,
  context: string,
  palette: string,
): Promise<DraftResult> {
  const prompt = [
    RULES,
    palette,
    'Ни один документ не описывает это поведение. Вот код:',
    code,
    context,
    'Заведи документ, если здесь есть правило или сценарий, который не понять из одного файла.',
    'Если это обычная механика без своего поведения, ответь SKIP.',
    replyFormat(true),
  ]
    .filter(Boolean)
    .join(NEWLINE + NEWLINE)

  const reply = await ask(prompt, opts.model, 180_000)
  if (!reply) return skip('модель не ответила')
  const parsed = parseReply(reply)
  if (parsed.kind === 'skip') return skip('модель решила, что документ не нужен')
  if (parsed.kind === 'unparsed') return skip(`ответ не разобрался: ${parsed.head}`)

  const title = parsed.head.get('TITLE')
  if (!title) return skip('модель не дала названия')

  const body = await settle(opts, docsDir, prompt, parsed)
  if (typeof body !== 'string') return body

  // Документ без якорей расхождения с кодом не покажет никогда, потому что
  // сверять не с чем. Он хуже отсутствующего: в библиотеке он выглядит
  // покрытием, а на деле тихо устаревает. Модель регулярно называет пути на
  // глаз, и всё, чего нет в карте, отбрасывается, так что пустой список тут
  // обычное дело, а не редкость.
  const anchors = parseAnchors(parsed.head.get('ANCHORS') ?? '', opts.db)
  if (anchors.length === 0) return skip('модель не назвала ни одного якоря, который есть в карте')

  const path = `${docsDir}/${fileName(title)}`
  // Существующий файл не затирается: под тем же названием может лежать чужая
  // работа, и потерять её дороже, чем не завести ещё один документ.
  if (existsSync(join(opts.root, path))) return skip(`такой документ уже есть: ${path}`)

  const flow = parsed.head.get('FLOW')
  const doc = parseDocument(path, body)
  const next: LogicDocument = {
    ...doc,
    title,
    // Новый документ всегда черновик: его никто не читал.
    status: 'draft',
    area: parsed.head.get('AREA') ?? '',
    summary: parsed.head.get('SUMMARY') ?? '',
    updated: today(),
    checked: null,
    anchors,
    flow: flow ? keepKnownSteps(parseFlow(flow), opts.db) : [],
    body,
  }
  await writeFile(join(opts.root, path), serializeDocument(next), 'utf8')
  return { action: 'created', path }
}

/** Якоря, которые модель назвала, но только те, что действительно есть в карте. */
function parseAnchors(raw: string, db: DatabaseSync): LogicDocument['anchors'] {
  const out: LogicDocument['anchors'] = []
  for (const part of raw.split(',')) {
    const text = part.trim()
    if (!text) continue
    const cut = text.lastIndexOf(':')
    if (cut <= 0) continue
    const file = text.slice(0, cut)
    const symbol = text.slice(cut + 1).trim()
    // Придуманный якорь хуже отсутствующего: он молча сломает сверку.
    if (!findSymbolNode(db, file, symbol)) continue
    out.push({ file, symbol, fingerprint: '' })
  }
  return out
}
