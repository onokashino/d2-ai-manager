import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initCli, isBroken, cliTarget } from '../../src/cli/init.js'

const dirs: string[] = []

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-init-'))
  dirs.push(dir)
  return dir
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const read = (root: string, file: string): any =>
  JSON.parse(readFileSync(join(root, file), 'utf8'))

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('initCli', () => {
  it('writes hooks for Claude Code where Claude Code looks for them', async () => {
    const root = workspace()
    const result = await initCli(root, 'claude', 'aimd2 hook')

    expect(result).toEqual({ path: '.claude/settings.json', unchanged: false })
    const config = read(root, '.claude/settings.json')
    expect(Object.keys(config.hooks)).toEqual(['SessionStart', 'PostToolUse'])
    expect(config.hooks.PostToolUse[0].matcher).toBe('Edit|Write')
  })

  it('writes hooks for Codex with the matcher its patch tool answers to', async () => {
    const root = workspace()
    const result = await initCli(root, 'codex', 'aimd2 hook')

    expect(result).toEqual({ path: '.codex/hooks.json', unchanged: false })
    // Codex правит файлы через apply_patch и принимает привычные имена как
    // синонимы, поэтому в сопоставлении стоят все три.
    const config = read(root, '.codex/hooks.json')
    expect(config.hooks.PostToolUse[0].matcher).toBe('apply_patch|Edit|Write')
  })

  it('keeps settings that were already in the file', async () => {
    const root = workspace()
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(
      join(root, '.claude', 'settings.json'),
      JSON.stringify({
        permissions: { allow: ['Bash(npm test)'] },
        hooks: { Notification: [{ hooks: [{ type: 'command', command: 'своё' }] }] },
      }),
      'utf8',
    )

    await initCli(root, 'claude', 'aimd2 hook')

    // В этом файле лежат права и чужие хуки. Затереть их значит сломать
    // человеку окружение ради своей одной строчки.
    const config = read(root, '.claude/settings.json')
    expect(config.permissions.allow).toEqual(['Bash(npm test)'])
    expect(config.hooks.Notification[0].hooks[0].command).toBe('своё')
    expect(config.hooks.SessionStart).toBeDefined()
  })

  it('reports that nothing changed on a second run', async () => {
    const root = workspace()
    await initCli(root, 'claude', 'aimd2 hook')
    expect(await initCli(root, 'claude', 'aimd2 hook')).toEqual({
      path: '.claude/settings.json',
      unchanged: true,
    })
  })

  it('tells a broken file apart from a missing one', async () => {
    const root = workspace()
    expect(await isBroken(join(root, cliTarget('claude')))).toBe(false)

    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude', 'settings.json'), '{ сломано', 'utf8')
    expect(await isBroken(join(root, cliTarget('claude')))).toBe(true)
  })

  it('does not create the other console directory', async () => {
    const root = workspace()
    await initCli(root, 'codex', 'aimd2 hook')
    expect(existsSync(join(root, '.claude'))).toBe(false)
  })
})
