import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runHook, touchedFiles } from '../../src/cli/hook.js'
import { run } from '../../src/cli/index.js'

const FIXTURE = join(import.meta.dirname, '..', 'fixtures', 'sample-ts')
const dirs: string[] = []

function project(doc?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-hook-'))
  dirs.push(dir)
  const root = join(dir, 'project')
  cpSync(FIXTURE, root, { recursive: true })

  mkdirSync(join(root, 'docs', 'logic'), { recursive: true })
  if (doc !== undefined) writeFileSync(join(root, 'docs', 'logic', 'a.d2'), doc, 'utf8')
  return root
}

const ANCHORED = '# title: Проверка подписи\n# anchors: src/auth/token.ts:verifyToken\n\na -> b\n'

const event = (payload: Record<string, unknown>): string => JSON.stringify(payload)

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

/** Заплатка Codex, как её кладут в tool_input.command. */
const patch = (...files: string[]): string =>
  ['apply_patch <<EOF', '*** Begin Patch', ...files, '*** End Patch', 'EOF'].join('\n')

describe('touchedFiles', () => {
  it('берёт путь из file_path, как его кладёт Claude Code', () => {
    expect(touchedFiles({ file_path: 'src/a.ts' })).toEqual(['src/a.ts'])
  })

  it('достаёт все файлы из заплатки, как её кладёт Codex', () => {
    // Одна заплатка трогает несколько файлов сразу, и пропустить второй значит
    // промолчать про документ, который на него опирается.
    const command = patch(
      '*** Update File: src/a.ts',
      '@@',
      '-было',
      '+стало',
      '*** Add File: src/b.ts',
      '*** Delete File: src/c.ts',
    )
    expect(touchedFiles({ command })).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('молчит, когда путей нет вовсе', () => {
    expect(touchedFiles({ command: 'npm test' })).toEqual([])
    expect(touchedFiles({})).toEqual([])
    expect(touchedFiles(undefined)).toEqual([])
  })
})

describe('runHook', () => {
  it('разбирает правку, пришедшую заплаткой Codex', async () => {
    const root = project(ANCHORED)

    const reply = await runHook(
      event({
        hook_event_name: 'PostToolUse',
        cwd: root,
        tool_name: 'apply_patch',
        tool_input: {
          command: patch('*** Update File: src/auth/token.ts', '*** Update File: src/auth/session.ts'),
        },
      }),
      root,
    )

    expect(reply.text).toContain('src/auth/token.ts')
    // Второй файл заплатки ничем не связан, и упоминать его незачем.
    expect(reply.text).not.toContain('session.ts')
    expect(reply.code).toBe(2)
  })

  it('не пересчитывает карту при очистке и сжатии посреди сессии', async () => {
    const root = project(ANCHORED)

    // Код с прошлой проверки не менялся, сканировать нечего.
    for (const source of ['clear', 'compact']) {
      expect(await runHook(event({ hook_event_name: 'SessionStart', cwd: root, source }), root)).toEqual({
        text: '',
        stream: 'out',
        code: 0,
      })
    }
  })

  it('names the documents that lean on a file the agent just edited', async () => {
    const root = project(ANCHORED)

    const reply = await runHook(
      event({
        hook_event_name: 'PostToolUse',
        cwd: root,
        tool_input: { file_path: join(root, 'src', 'auth', 'token.ts') },
      }),
      root,
    )

    expect(reply.text).toContain('src/auth/token.ts')
    expect(reply.text).toContain('Проверка подписи')
    // Поток ошибок и код два: у PostToolUse только так текст доходит до модели,
    // и вызов при этом уже состоялся, заблокировать его это не может.
    expect(reply.stream).toBe('err')
    expect(reply.code).toBe(2)
  })

  it('stays quiet about a file no document anchors', async () => {
    const root = project(ANCHORED)

    const reply = await runHook(
      event({
        hook_event_name: 'PostToolUse',
        cwd: root,
        tool_input: { file_path: join(root, 'src', 'auth', 'session.ts') },
      }),
      root,
    )

    expect(reply).toEqual({ text: '', stream: 'out', code: 0 })
  })

  it('reports documents that drifted at the start of a session', async () => {
    const root = project(ANCHORED)
    await run(['scan', '--path', root])
    await run(['logic', 'seal', '--path', root])

    // Тело функции под якорем переписано: имя и файл на месте, поведение другое.
    writeFileSync(
      join(root, 'src', 'auth', 'token.ts'),
      'export function verifyToken(raw: string): string {\n  return raw.trim()\n}\n',
      'utf8',
    )

    const reply = await runHook(event({ hook_event_name: 'SessionStart', cwd: root }), root)

    expect(reply.text).toContain('Проверка подписи')
    expect(reply.text).toContain('код переписали после сверки')
    // Начало сессии ничего не блокирует, текст идёт обычным выводом.
    expect(reply.stream).toBe('out')
    expect(reply.code).toBe(0)
  })

  it('says nothing at the start of a session while everything matches', async () => {
    const root = project(ANCHORED)
    await run(['scan', '--path', root])
    await run(['logic', 'seal', '--path', root])

    const reply = await runHook(event({ hook_event_name: 'SessionStart', cwd: root }), root)
    expect(reply.text).toBe('')
  })

  it('asks for a scan when there are documents but no map', async () => {
    const root = project(ANCHORED)

    const reply = await runHook(event({ hook_event_name: 'SessionStart', cwd: root }), root)
    expect(reply.text).toContain('aimd2 scan')
    expect(reply.code).toBe(0)
  })

  it('keeps silent on anything it does not understand', async () => {
    const root = project(ANCHORED)

    // Сломанный хук не должен мешать сессии, поэтому на мусор, пустоту и
    // незнакомое событие ответ один: молчание с нулевым кодом.
    for (const raw of ['', 'не json вовсе', '[]', event({ hook_event_name: 'Notification', cwd: root })]) {
      expect(await runHook(raw, root)).toEqual({ text: '', stream: 'out', code: 0 })
    }
  })

  it('ignores a project without a logic library', async () => {
    const root = project()

    rmSync(join(root, 'docs'), { recursive: true, force: true })
    const reply = await runHook(
      event({
        hook_event_name: 'PostToolUse',
        cwd: root,
        tool_input: { file_path: join(root, 'src', 'auth', 'token.ts') },
      }),
      root,
    )

    expect(reply.text).toBe('')
  })
})
