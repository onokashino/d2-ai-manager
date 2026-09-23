import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadConfig,
  saveConfig,
  normalizeConfig,
  withinRoots,
  mayContain,
  DEFAULT_CONFIG,
  CONFIG_FILE,
} from '../../src/logic/config.js'
import { walkFiles } from '../../src/scan/walk.js'
import { readFile } from 'node:fs/promises'

const dirs: string[] = []

function project(files: string[], config?: unknown): string {
  const root = mkdtempSync(join(tmpdir(), 'aimd2-conf-'))
  dirs.push(root)
  for (const file of files) {
    const full = join(root, file)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, 'export const x = 1\n')
  }
  if (config !== undefined) writeFileSync(join(root, CONFIG_FILE), JSON.stringify(config))
  return root
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('normalizeConfig', () => {
  it('fills in every missing field', () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG)
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG)
  })

  it('drops rubbish instead of trusting it', () => {
    // Файл правят руками, и половина настроек в нём обычное дело. Упасть на
    // нём значило бы уронить скан из-за опечатки в необязательном файле.
    const config = normalizeConfig({ roots: 'не массив', exclude: [1, 'ok'], docsDir: '', model: 'rm -rf /' })
    expect(config.roots).toEqual([])
    expect(config.exclude).toEqual(['ok'])
    expect(config.docsDir).toBe(DEFAULT_CONFIG.docsDir)
    // Имя модели уезжает в строку команды, поэтому всё непохожее отбрасывается.
    expect(config.model).toBe(DEFAULT_CONFIG.model)
  })

  it('tidies up how paths are written', () => {
    const config = normalizeConfig({ roots: ['./apps/backend/', 'packages\\money'], docsDir: 'docs/logic/' })
    expect(config.roots).toEqual(['apps/backend', 'packages/money'])
    expect(config.docsDir).toBe('docs/logic')
  })

  it('treats a missing studio flag as switched on', () => {
    expect(normalizeConfig({ studio: {} }).studio.autoStart).toBe(true)
    expect(normalizeConfig({ studio: { autoStart: false } }).studio.autoStart).toBe(false)
    expect(normalizeConfig({ studio: { idleMinutes: -5 } }).studio.idleMinutes).toBe(60)
    expect(normalizeConfig({ studio: { idleMinutes: 0 } }).studio.idleMinutes).toBe(0)
  })
})

describe('loadConfig', () => {
  it('falls back to defaults when there is no file or it is broken', async () => {
    expect(await loadConfig(project(['a.ts']))).toEqual(DEFAULT_CONFIG)

    const broken = project(['a.ts'])
    writeFileSync(join(broken, CONFIG_FILE), '{ оборвано')
    expect(await loadConfig(broken)).toEqual(DEFAULT_CONFIG)
  })
})

describe('saveConfig', () => {
  it('keeps keys it does not know about', async () => {
    // Файл лежит в репозитории, и в нём могли появиться поля от руки или от
    // будущей версии. Переписать его целиком значило бы молча их выбросить.
    const root = project(['a.ts'], { $schema: 'чужое', roots: [] })
    await saveConfig(root, { ...DEFAULT_CONFIG, roots: ['src'] })

    const written = JSON.parse(await readFile(join(root, CONFIG_FILE), 'utf8')) as Record<string, unknown>
    expect(written['$schema']).toBe('чужое')
    expect(written['roots']).toEqual(['src'])
  })
})

describe('выбор каталогов', () => {
  it('lets the walker through a parent on the way to a chosen child', () => {
    expect(mayContain(['apps/backend'], 'apps')).toBe(true)
    expect(mayContain(['apps/backend'], 'apps/backend/src')).toBe(true)
    expect(mayContain(['apps/backend'], 'apps/frontend')).toBe(false)
    expect(mayContain([], 'что угодно')).toBe(true)
  })

  it('keeps only files under the chosen roots', () => {
    expect(withinRoots(['apps/backend'], 'apps/backend/src/a.ts')).toBe(true)
    expect(withinRoots(['apps/backend'], 'apps/backend-tools/a.ts')).toBe(false)
    expect(withinRoots([], 'anything.ts')).toBe(true)
  })
})

describe('walkFiles с настройками', () => {
  const tree = ['apps/backend/src/a.ts', 'apps/frontend/src/b.ts', 'packages/money/c.ts', 'root.ts']

  it('takes the whole project when nothing is chosen', async () => {
    expect((await walkFiles(project(tree))).length).toBe(4)
  })

  it('takes only the chosen branches of a monorepo', async () => {
    const root = project(tree)
    const files = await walkFiles(root, { ...DEFAULT_CONFIG, roots: ['apps/backend', 'packages'] })
    expect(files).toEqual(['apps/backend/src/a.ts', 'packages/money/c.ts'])
  })

  it('honours its own ignore patterns on top of gitignore', async () => {
    const root = project(tree)
    const files = await walkFiles(root, { ...DEFAULT_CONFIG, exclude: ['apps/frontend/**', 'root.ts'] })
    expect(files).toEqual(['apps/backend/src/a.ts', 'packages/money/c.ts'])
  })
})
