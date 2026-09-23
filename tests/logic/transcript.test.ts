import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLastTurn } from '../../src/logic/transcript.js'
import { parseReply } from '../../src/logic/draft.js'

const dirs: string[] = []
const ROOT = process.platform === 'win32' ? 'D:/project' : '/project'

function transcript(entries: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'aimd2-log-'))
  dirs.push(dir)
  const path = join(dir, 'session.jsonl')
  writeFileSync(path, `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8')
  return path
}

function human(text: string): unknown {
  return { type: 'user', message: { role: 'user', content: text } }
}

function agent(...content: unknown[]): unknown {
  return { type: 'assistant', message: { role: 'assistant', content } }
}

function edited(file: string): unknown {
  return { type: 'tool_use', name: 'Edit', input: { file_path: `${ROOT}/${file}` } }
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('readLastTurn', () => {
  it('takes only what happened after the last human message', async () => {
    const path = transcript([
      human('первая просьба'),
      agent(edited('src/old.ts')),
      human('вторая просьба'),
      agent(edited('src/new.ts')),
    ])

    const turn = await readLastTurn(path, ROOT)
    // Вчерашние темы в подсказке только сбивают: документ описывает то, что
    // решили сейчас.
    expect(turn.files).toEqual(['src/new.ts'])
    expect(turn.text).toContain('вторая просьба')
    expect(turn.text).not.toContain('первая просьба')
  })

  it('keeps the reasoning, not just the answer', async () => {
    const path = transcript([
      human('почему так'),
      agent({ type: 'thinking', thinking: 'потому что иначе теряется порядок' }, { type: 'text', text: 'сделал' }),
    ])

    const turn = await readLastTurn(path, ROOT)
    // Из одного диффа не видно, почему код стал таким, а документ логики
    // отвечает как раз на "почему".
    expect(turn.text).toContain('потому что иначе теряется порядок')
    expect(turn.text).toContain('сделал')
  })

  it('ignores files outside the project', async () => {
    const other = process.platform === 'win32' ? 'C:/elsewhere/x.ts' : '/elsewhere/x.ts'
    const path = transcript([
      human('правка'),
      agent({ type: 'tool_use', name: 'Edit', input: { file_path: other } }, edited('src/a.ts')),
    ])

    const turn = await readLastTurn(path, ROOT)
    expect(turn.files).toEqual(['src/a.ts'])
  })

  it('skips what subagents did', async () => {
    const path = transcript([
      human('правка'),
      { ...(agent(edited('src/side.ts')) as object), isSidechain: true },
      agent(edited('src/main.ts')),
    ])

    const turn = await readLastTurn(path, ROOT)
    expect(turn.files).toEqual(['src/main.ts'])
  })

  it('survives a broken line instead of losing the whole turn', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'aimd2-log-'))
    dirs.push(dir)
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, `${JSON.stringify(human('правка'))}\n{ оборвано\n${JSON.stringify(agent(edited('src/a.ts')))}\n`)

    const turn = await readLastTurn(path, ROOT)
    expect(turn.files).toEqual(['src/a.ts'])
  })

  it('cuts the beginning when the turn is too long to pass on', async () => {
    const path = transcript([human('начало'), agent({ type: 'text', text: 'x'.repeat(5000) })])

    const turn = await readLastTurn(path, ROOT, 1000)
    // Режется начало: ближе к концу лежит то, к чему разговор пришёл.
    expect(turn.text.length).toBeLessThan(1100)
    expect(turn.text.startsWith('...')).toBe(true)
  })

  it('reports nothing for a file it cannot read', async () => {
    expect(await readLastTurn(join(tmpdir(), 'нет-такого.jsonl'), ROOT)).toEqual({ text: '', files: [] })
  })
})

describe('parseReply', () => {
  it('reads the header and the body', () => {
    const parsed = parseReply(`SUMMARY: что делает
FLOW: a.ts:one -> b.ts:two
---
a -> b
`)
    expect(parsed.kind).toBe('ok')
    if (parsed.kind !== 'ok') return
    expect(parsed.head.get('SUMMARY')).toBe('что делает')
    expect(parsed.head.get('FLOW')).toBe('a.ts:one -> b.ts:two')
    expect(parsed.body.trim()).toBe('a -> b')
  })

  it('tells a deliberate refusal from a broken answer', () => {
    // Отказ это нормальная работа, неразобранный ответ это поломка. Свалив их
    // в одну кучу, мы перестали бы отличать одно от другого в отчёте.
    expect(parseReply('SKIP').kind).toBe('skip')
    expect(parseReply('  SKIP, писать нечего  ').kind).toBe('skip')
    expect(parseReply('просто текст без разделителя').kind).toBe('unparsed')
    expect(parseReply('').kind).toBe('unparsed')
  })

  it('refuses an answer whose body is empty', () => {
    // Пустое тело затёрло бы документ: лучше не писать ничего.
    expect(
      parseReply(`SUMMARY: что-то
---
   
`).kind,
    ).toBe('unparsed')
  })

  it('keeps the first line of a broken answer for the report', () => {
    const parsed = parseReply(`Извините, я не могу
и вот почему`)
    expect(parsed.kind).toBe('unparsed')
    if (parsed.kind !== 'unparsed') return
    expect(parsed.head).toBe('Извините, я не могу')
  })
})
