import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { extractSymbols } from '../../src/scan/symbols.js'

const FIXTURES = join(import.meta.dirname, '..', 'fixtures')

describe('extractSymbols, typescript', () => {
  it('finds classes, methods, functions and interfaces with nested paths', async () => {
    const src = await readFile(join(FIXTURES, 'sample-ts', 'src', 'auth', 'token.ts'), 'utf8')
    const symbols = await extractSymbols(src, 'typescript')
    const paths = symbols.map((s) => s.symbolPath).sort()
    expect(paths).toEqual(['TokenService', 'TokenService/verify', 'User', 'verifyToken'])
  })

  it('reports one based line numbers', async () => {
    const symbols = await extractSymbols('export function f() {\n  return 1\n}\n', 'typescript')
    expect(symbols[0]?.startLine).toBe(1)
    expect(symbols[0]?.endLine).toBe(3)
  })

  it('assigns the right kinds', async () => {
    const src = await readFile(join(FIXTURES, 'sample-ts', 'src', 'auth', 'token.ts'), 'utf8')
    const symbols = await extractSymbols(src, 'typescript')
    const byPath = new Map(symbols.map((s) => [s.symbolPath, s.kind]))
    expect(byPath.get('TokenService')).toBe('class')
    expect(byPath.get('TokenService/verify')).toBe('method')
    expect(byPath.get('verifyToken')).toBe('function')
    expect(byPath.get('User')).toBe('interface')
  })
})

describe('extractSymbols, python', () => {
  it('finds classes and functions', async () => {
    const src = await readFile(join(FIXTURES, 'sample-py', 'app', 'service.py'), 'utf8')
    const symbols = await extractSymbols(src, 'python')
    expect(symbols.map((s) => s.symbolPath).sort()).toEqual(['Service', 'Service/handle', 'build'])
  })
})

describe('extractSymbols, nesting rules', () => {
  it('keeps a function nested in a function a function, not a method', async () => {
    const symbols = await extractSymbols('function outer() {\n  function inner() {}\n}\n', 'typescript')
    const inner = symbols.find((s) => s.symbolPath === 'outer/inner')
    expect(inner?.kind).toBe('function')
  })

  it('keeps a method of a class a method', async () => {
    const symbols = await extractSymbols('class A {\n  m() {}\n}\n', 'typescript')
    expect(symbols.find((s) => s.symbolPath === 'A/m')?.kind).toBe('method')
  })

  it('does not collide the members of two anonymous classes', async () => {
    const src = 'export const A = class { m() {} }\nexport const B = class { m() {} }\n'
    const paths = (await extractSymbols(src, 'typescript')).map((s) => s.symbolPath)
    const members = paths.filter((p) => p.endsWith('/m'))
    expect(members).toHaveLength(2)
    expect(new Set(members).size).toBe(2)
  })
})

describe('extractSymbols, unsupported language', () => {
  it('returns an empty list instead of throwing', async () => {
    expect(await extractSymbols('whatever', 'klingon')).toEqual([])
  })
})

describe('extractSymbols, rust', () => {
  const load = () => readFile(join(FIXTURES, 'sample-rs', 'src', 'order.rs'), 'utf8')

  it('keeps a struct and its impl block apart', async () => {
    const symbols = await extractSymbols(await load(), 'rust')
    const byPath = new Map(symbols.map((s) => [s.symbolPath, s.kind]))

    // impl типа не объявляет, тип объявлен рядом в struct. Считать impl
    // определением значило бы дать обоим один путь и один вид, то есть один
    // узел на две разные вещи.
    expect(byPath.get('Order')).toBe('class')
    expect(byPath.get('Order/total')).toBe('method')
    expect(byPath.get('Order/secret')).toBe('method')
  })

  it('does not let a module and the file share a name', async () => {
    const symbols = await extractSymbols(await load(), 'rust')
    const paths = symbols.map((s) => s.symbolPath)

    // Обе функции называются compute, и без области имён они дали бы один путь.
    expect(paths).toContain('compute')
    expect(paths).toContain('tests/compute')
  })

  it('reads enums, traits and the methods a trait declares', async () => {
    const symbols = await extractSymbols(await load(), 'rust')
    const byPath = new Map(symbols.map((s) => [s.symbolPath, s.kind]))

    expect(byPath.get('Status')).toBe('class')
    expect(byPath.get('Payable')).toBe('interface')
    // У объявления в трейте нет тела, но поведение описывается именно им.
    expect(byPath.get('Payable/pay')).toBe('method')
  })

  it('sees a plain call and leaves the ones it cannot resolve alone', async () => {
    const { extractOutline } = await import('../../src/scan/symbols.js')
    const outline = await extractOutline(await load(), 'rust')

    expect(outline.calls).toEqual([{ from: 'Order/total', callee: 'compute' }])
    // self.total() и super::compute() намеренно не берутся: определить
    // статически, чем окажется приёмник, в общем случае нельзя.
    expect(outline.calls.map((c) => c.callee)).not.toContain('total')
  })
})
