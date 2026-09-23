import { describe, it, expect } from 'vitest'
import { extractImportSpecifiers, resolveImport } from '../../src/scan/imports.js'

describe('extractImportSpecifiers', () => {
  it('reads typescript import sources', async () => {
    const src = "import { a } from './a'\nimport b from '../b'\nexport { c } from './c'\n"
    expect(await extractImportSpecifiers(src, 'typescript')).toEqual(['./a', '../b', './c'])
  })

  it('reads python imports', async () => {
    const src = 'import os\nfrom app.service import build\n'
    expect(await extractImportSpecifiers(src, 'python')).toEqual(['os', 'app.service'])
  })

  it('returns an empty list for unsupported languages', async () => {
    expect(await extractImportSpecifiers('x', 'klingon')).toEqual([])
  })

  it('reads an aliased python import', async () => {
    expect(await extractImportSpecifiers('import numpy as np\n', 'python')).toEqual(['numpy'])
  })

  it('reads every name of a multi-name python import', async () => {
    expect(await extractImportSpecifiers('import os, sys\n', 'python')).toEqual(['os', 'sys'])
  })
})

describe('resolveImport', () => {
  const known = new Set(['src/auth/token.ts', 'src/auth/session.ts', 'src/index.ts', 'src/ui/index.tsx'])

  it('resolves a relative sibling with an added extension', () => {
    expect(resolveImport('src/auth/token.ts', './session', known)).toBe('src/auth/session.ts')
  })

  it('resolves a parent relative path', () => {
    expect(resolveImport('src/auth/token.ts', '../index', known)).toBe('src/index.ts')
  })

  it('resolves a directory index file', () => {
    expect(resolveImport('src/index.ts', './ui', known)).toBe('src/ui/index.tsx')
  })

  it('returns null for external packages', () => {
    expect(resolveImport('src/index.ts', 'react', known)).toBeNull()
  })

  it('returns null when the target is not in the project', () => {
    expect(resolveImport('src/index.ts', './missing', known)).toBeNull()
  })

  it('does not resolve a typescript import to a python file', () => {
    expect(resolveImport('src/index.ts', './config', new Set(['src/config.py']))).toBeNull()
  })

  // Здесь был тест, разрешавший './service' в 'app/service/__init__.py'.
  // Реальный python такой спецификатор не порождает: импорты в нём точечные,
  // а не путевые, и разрешение точечных имён в пути на этом этапе не делается.
  // Python здесь только про символы, рёбра импортов у него не строятся.

  it('resolves a typescript esm import written with a js extension', () => {
    // Собственный код этого проекта написан именно так, и без подстановки
    // расширения граф его импортов оказывался пустым.
    expect(resolveImport('src/store/edges.ts', './tx.js', new Set(['src/store/tx.ts']))).toBe('src/store/tx.ts')
  })

  it('still prefers a real js file over its typescript namesake', () => {
    const both = new Set(['src/store/tx.js', 'src/store/tx.ts'])
    expect(resolveImport('src/store/edges.ts', './tx.js', both)).toBe('src/store/tx.js')
  })
})
