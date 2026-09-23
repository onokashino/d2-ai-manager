import { createHash } from 'node:crypto'
import type { Anchor } from './types.js'

const SEP = '\u0000'

export function toPosix(p: string): string {
  return p.split('\\').join('/')
}

export function normalizeTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, ' ')
}

function digest(parts: string[]): string {
  return createHash('sha256').update(parts.join(SEP)).digest('hex').slice(0, 16)
}

// kind это строка, а не NodeKind: вызывающий уточняет вид символа суффиксом
// вроде 'symbol:class'. Без этого класс и интерфейс с одним именем в одном
// файле дают один идентификатор, то есть один узел на две разные сущности.
export function symbolNodeId(relPath: string, symbolPath: string, kind: string): string {
  return digest([kind, toPosix(relPath), symbolPath])
}

export function semanticNodeId(anchors: Anchor[], title: string): string {
  // Пара склеивается тем же SEP, что и список: '#' встречается и в путях, и в
  // именах символов, из-за чего разные наборы якорей давали бы один хеш.
  const key = anchors
    .map((a) => `${toPosix(a.file)}${SEP}${a.symbol}`)
    .sort()
    .join(SEP)
  return digest([normalizeTitle(title), key])
}
