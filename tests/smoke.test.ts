import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_VERSION } from '../src/version.js'

describe('package', () => {
  it('exposes a semver version string', () => {
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('reports the version the package was published with', () => {
    // Проверка формата пропускала устаревшую строку: 0.1.0 выглядит верным
    // номером и после выпуска 0.1.1, поэтому сверяемся с самим манифестом.
    const manifest = readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')
    expect(PACKAGE_VERSION).toBe((JSON.parse(manifest) as { version: string }).version)
  })
})
