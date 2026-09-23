import { describe, it, expect } from 'vitest'
import { symbolNodeId, semanticNodeId, toPosix, normalizeTitle } from '../../src/graph/ids.js'
import type { Anchor } from '../../src/graph/types.js'

describe('toPosix', () => {
  it('converts windows separators', () => {
    expect(toPosix('src\\auth\\token.ts')).toBe('src/auth/token.ts')
  })
})

describe('normalizeTitle', () => {
  it('trims, lowercases and collapses whitespace', () => {
    expect(normalizeTitle('  Verify   Token  ')).toBe('verify token')
  })
})

describe('symbolNodeId', () => {
  it('is stable across separator styles', () => {
    const a = symbolNodeId('src/auth/token.ts', 'verifyToken', 'symbol')
    const b = symbolNodeId('src\\auth\\token.ts', 'verifyToken', 'symbol')
    expect(a).toBe(b)
  })

  it('does not depend on line numbers because it does not take them', () => {
    const a = symbolNodeId('src/auth/token.ts', 'verifyToken', 'symbol')
    const b = symbolNodeId('src/auth/token.ts', 'verifyToken', 'symbol')
    expect(a).toBe(b)
  })

  it('differs for different symbol paths', () => {
    const a = symbolNodeId('src/auth/token.ts', 'verifyToken', 'symbol')
    const b = symbolNodeId('src/auth/token.ts', 'AuthService/verifyToken', 'symbol')
    expect(a).not.toBe(b)
  })

  it('differs for different kinds', () => {
    const a = symbolNodeId('src/auth/token.ts', '', 'module')
    const b = symbolNodeId('src/auth/token.ts', '', 'symbol')
    expect(a).not.toBe(b)
  })

  it('returns a 16 character hex string', () => {
    expect(symbolNodeId('a.ts', 'f', 'symbol')).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('semanticNodeId', () => {
  const anchors: Anchor[] = [
    { file: 'src/auth/token.ts', symbol: 'verifyToken', startLine: 42, endLine: 88, commit: null },
    { file: 'src/auth/session.ts', symbol: 'refresh', startLine: 5, endLine: 20, commit: null },
  ]

  it('ignores anchor order', () => {
    const a = semanticNodeId(anchors, 'Проверка токена')
    const b = semanticNodeId([...anchors].reverse(), 'Проверка токена')
    expect(a).toBe(b)
  })

  it('ignores line numbers', () => {
    const moved = anchors.map((x) => ({ ...x, startLine: x.startLine + 100, endLine: x.endLine + 100 }))
    expect(semanticNodeId(moved, 'Проверка токена')).toBe(semanticNodeId(anchors, 'Проверка токена'))
  })

  it('ignores title casing and extra spaces', () => {
    expect(semanticNodeId(anchors, '  проверка   ТОКЕНА ')).toBe(semanticNodeId(anchors, 'Проверка токена'))
  })

  it('does not collide when a hash character appears in a path or symbol', () => {
    const left = semanticNodeId([{ file: 'a#b', symbol: 'c', startLine: 1, endLine: 2, commit: null }], 'x')
    const right = semanticNodeId([{ file: 'a', symbol: 'b#c', startLine: 1, endLine: 2, commit: null }], 'x')
    expect(left).not.toBe(right)
  })
})
