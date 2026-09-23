import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { walkFiles } from '../../src/scan/walk.js'
import { hashContent } from '../../src/scan/hash.js'

const ROOT = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')

describe('walkFiles', () => {
  it('returns relative posix paths sorted', async () => {
    const files = await walkFiles(ROOT)
    expect(files).toEqual(['src/auth/session.ts', 'src/auth/token.ts', 'src/index.ts'])
  })

  it('honours .gitignore', async () => {
    const files = await walkFiles(ROOT)
    expect(files.some((f) => f.startsWith('generated/'))).toBe(false)
  })

  it('skips the tool own data directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimd2-walk-'))
    try {
      mkdirSync(join(dir, '.aimd2'), { recursive: true })
      writeFileSync(join(dir, '.aimd2', 'graph.sqlite'), 'pretend database')
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
      expect(await walkFiles(dir)).toEqual(['a.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('honours a .gitignore of a nested directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimd2-walk-'))
    try {
      mkdirSync(join(dir, 'pkg', 'secret'), { recursive: true })
      mkdirSync(join(dir, 'other', 'secret'), { recursive: true })
      writeFileSync(join(dir, 'pkg', '.gitignore'), 'secret/\n')
      writeFileSync(join(dir, 'pkg', 'secret', 'hidden.ts'), 'export const hidden = 1\n')
      writeFileSync(join(dir, 'pkg', 'kept.ts'), 'export const kept = 1\n')
      // Одноимённый каталог вне pkg остаётся видимым: вложенный .gitignore
      // действует только на своё поддерево, как в git.
      writeFileSync(join(dir, 'other', 'secret', 'kept.ts'), 'export const kept = 2\n')
      expect(await walkFiles(dir)).toEqual(['other/secret/kept.ts', 'pkg/kept.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips the build output directories of other ecosystems', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimd2-walk-'))
    try {
      for (const name of ['.next', 'coverage', 'target', 'out', '__pycache__', 'venv']) {
        mkdirSync(join(dir, name), { recursive: true })
        writeFileSync(join(dir, name, 'junk.ts'), 'export const junk = 1\n')
      }
      writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n')
      expect(await walkFiles(dir)).toEqual(['a.ts'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('hashContent', () => {
  it('is stable and short', () => {
    expect(hashContent('abc')).toBe(hashContent('abc'))
    expect(hashContent('abc')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('differs for different content', () => {
    expect(hashContent('abc')).not.toBe(hashContent('abd'))
  })
})
