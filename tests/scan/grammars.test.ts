import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { languageForPath, loadLanguage, GRAMMAR_DIR } from '../../src/scan/grammars.js'

describe('languageForPath', () => {
  it('maps known extensions', () => {
    expect(languageForPath('src/a.ts')).toBe('typescript')
    expect(languageForPath('src/a.tsx')).toBe('tsx')
    expect(languageForPath('src/a.js')).toBe('javascript')
    expect(languageForPath('src/a.py')).toBe('python')
  })

  it('returns null for unknown extensions', () => {
    expect(languageForPath('README.md')).toBeNull()
    expect(languageForPath('data.bin')).toBeNull()
  })
})

describe('loadLanguage', () => {
  it('returns null instead of throwing when the grammar file is absent', async () => {
    expect(await loadLanguage('klingon')).toBeNull()
  })

  it('returns null instead of throwing when the grammar file is corrupt', async () => {
    // Отсутствующий файл отсекается ранней проверкой и до wasm не доходит.
    // Здесь закрывается другой путь: файл есть, но валидным wasm не является.
    // Каталог временный: поставляемый vendor/grammars тест не трогает.
    const dir = mkdtempSync(join(tmpdir(), 'aimd2-grammars-'))
    try {
      writeFileSync(join(dir, 'tree-sitter-broken.wasm'), 'this is not webassembly at all')
      expect(await loadLanguage('broken', dir)).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('defaults to the grammar directory shipped with the package', () => {
    expect(GRAMMAR_DIR.endsWith(join('vendor', 'grammars'))).toBe(true)
  })
})
