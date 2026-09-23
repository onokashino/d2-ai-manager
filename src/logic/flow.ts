import type { DatabaseSync } from 'node:sqlite'
import { findSymbolNode } from '../store/nodes.js'
import { toPosix } from '../graph/ids.js'

/** Одна точка хода: файл и символ в нём. */
export interface FlowStep {
  file: string
  symbol: string
}

/**
 * Что не сошлось в описанном ходе.
 *
 * Два вида намеренно разведены. Пропавший шаг это факт: символа нет в карте,
 * значит документ описывает то, чего больше не существует. Пропавший переход
 * это подозрение: карта вызовов знает только голые вызовы по имени и ничего не
 * знает про вызовы через точку, поэтому отсутствие ребра может оказаться нашей
 * слепотой, а не правкой кода. Считать их одинаково значит приучить читателя
 * не верить предупреждениям вообще.
 */
export type FlowIssue =
  | { kind: 'step-missing'; step: FlowStep }
  | { kind: 'link-missing'; from: FlowStep; to: FlowStep }

const ARROW = '->'

export function parseFlow(raw: string): FlowStep[] {
  const out: FlowStep[] = []
  for (const part of raw.split(ARROW)) {
    const text = part.trim()
    if (!text) continue
    // Двоеточие ищется с конца: в пути диска оно тоже встречается.
    const cut = text.lastIndexOf(':')
    if (cut <= 0) continue
    const symbol = text.slice(cut + 1).trim()
    // Шаг без символа бессмыслен: ход идёт через функции, а не через файлы.
    if (!symbol) continue
    out.push({ file: toPosix(text.slice(0, cut)), symbol })
  }
  return out
}

export function formatFlow(steps: FlowStep[]): string {
  return steps.map((s) => `${s.file}:${s.symbol}`).join(` ${ARROW} `)
}

function hasCall(db: DatabaseSync, from: string, to: string): boolean {
  const row = db
    .prepare("SELECT 1 AS ok FROM edges WHERE from_id = ? AND to_id = ? AND kind = 'calls'")
    .get(from, to) as { ok: number } | undefined
  return row !== undefined
}

export function checkFlow(db: DatabaseSync, steps: FlowStep[]): FlowIssue[] {
  const issues: FlowIssue[] = []
  const ids = steps.map((s) => findSymbolNode(db, s.file, s.symbol))

  for (const [i, step] of steps.entries()) {
    if (ids[i] === null) issues.push({ kind: 'step-missing', step })
  }

  for (let i = 0; i + 1 < steps.length; i += 1) {
    const from = ids[i]
    const to = ids[i + 1]
    // Про переход между шагами, которых нет, говорить нечего: о пропаже уже
    // сказано выше, а второе предупреждение про то же самое только шумит.
    if (!from || !to) continue
    if (!hasCall(db, from, to)) {
      issues.push({ kind: 'link-missing', from: steps[i] as FlowStep, to: steps[i + 1] as FlowStep })
    }
  }
  return issues
}

export interface TraceNode {
  step: FlowStep
  calls: TraceNode[]
}

interface AnchorRow {
  file: string
  symbol: string
}

function stepOf(db: DatabaseSync, id: string): FlowStep | null {
  const row = db.prepare('SELECT file, symbol FROM anchors WHERE node_id = ? LIMIT 1').get(id) as AnchorRow | undefined
  return row && row.symbol ? { file: row.file, symbol: row.symbol } : null
}

function calleesOf(db: DatabaseSync, id: string): string[] {
  const rows = db
    .prepare(
      `SELECT e.to_id AS id FROM edges e JOIN nodes n ON n.id = e.to_id
       WHERE e.from_id = ? AND e.kind = 'calls' AND n.status <> 'removed'
       ORDER BY n.title`,
    )
    .all(id) as { id: string }[]
  return rows.map((r) => r.id)
}

/**
 * Дерево вызовов от точки входа вглубь.
 *
 * Посещённое не разворачивается второй раз: в реальном коде пути сходятся, и
 * без этого один общий помощник размножил бы всё поддерево под каждым
 * вызывающим, а на цикле обход не кончился бы вовсе.
 */
export function traceCalls(db: DatabaseSync, from: FlowStep, depth: number): TraceNode | null {
  const rootId = findSymbolNode(db, from.file, from.symbol)
  if (!rootId) return null

  const seen = new Set<string>()

  function walk(id: string, step: FlowStep, left: number): TraceNode {
    const node: TraceNode = { step, calls: [] }
    if (left <= 0 || seen.has(id)) return node
    seen.add(id)

    for (const next of calleesOf(db, id)) {
      const target = stepOf(db, next)
      if (target) node.calls.push(walk(next, target, left - 1))
    }
    return node
  }

  return walk(rootId, from, depth)
}
