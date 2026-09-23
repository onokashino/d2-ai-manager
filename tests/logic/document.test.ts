import { describe, it, expect } from 'vitest'
import { parseDocument, serializeDocument } from '../../src/logic/document.js'

const SOURCE = `# title: Статусы заявки
# status: approved
# area: System
# summary: Тринадцать кодов жизненного цикла и кто их двигает
# updated: 2026-09-15
# anchors: src/request/status.ts:RequestStatus, src/admin/queue.ts

direction: down
created -> paid: оплата
`

describe('parseDocument', () => {
  it('reads the header', () => {
    const doc = parseDocument('docs/logic/status.d2', SOURCE)
    expect(doc.title).toBe('Статусы заявки')
    expect(doc.status).toBe('approved')
    expect(doc.area).toBe('System')
    expect(doc.summary).toBe('Тринадцать кодов жизненного цикла и кто их двигает')
    expect(doc.updated).toBe('2026-09-15')
  })

  it('reads anchors with and without a symbol', () => {
    const doc = parseDocument('docs/logic/status.d2', SOURCE)
    expect(doc.anchors).toEqual([
      { file: 'src/request/status.ts', symbol: 'RequestStatus', fingerprint: '' },
      { file: 'src/admin/queue.ts', symbol: '', fingerprint: '' },
    ])
  })

  it('keeps the body free of the header', () => {
    const doc = parseDocument('docs/logic/status.d2', SOURCE)
    expect(doc.body).toContain('created -> paid')
    expect(doc.body).not.toContain('# title:')
  })

  it('falls back to draft for an unknown status', () => {
    const doc = parseDocument('a.d2', '# title: X\n# status: неведомо\n\na -> b\n')
    expect(doc.status).toBe('draft')
  })

  it('falls back to the file name when there is no title', () => {
    const doc = parseDocument('docs/logic/corridor.d2', 'a -> b\n')
    expect(doc.title).toBe('corridor.d2')
    expect(doc.body).toBe('a -> b\n')
  })

  it('normalises the path and the anchor paths to forward slashes', () => {
    const doc = parseDocument('docs\\logic\\a.d2', '# title: X\n# anchors: src\\auth\\token.ts:verify\n\na -> b\n')
    expect(doc.path).toBe('docs/logic/a.d2')
    expect(doc.anchors[0]?.file).toBe('src/auth/token.ts')
  })

  it('reads who checked the document and when', () => {
    const doc = parseDocument('a.d2', '# title: X\n# checked: human 2026-09-23\n\na -> b\n')
    expect(doc.checked).toEqual({ by: 'human', on: '2026-09-23' })
  })

  it('treats an unreadable checked line as never checked', () => {
    // Выдумывать, кто сверял, нельзя: это заявление о доверии, и пустое
    // честнее угаданного.
    for (const raw of ['', 'кто-то вчера', 'human', 'robot 2026-09-23']) {
      const doc = parseDocument('a.d2', `# title: X\n# checked: ${raw}\n\na -> b\n`)
      expect(doc.checked).toBeNull()
    }
  })

  it('reads the fingerprint from the tail of an anchor', () => {
    const doc = parseDocument(
      'a.d2',
      '# title: X\n# anchors: src/a.ts:run@0123456789abcdef, src/b.ts@fedcba9876543210\n\na -> b\n',
    )
    expect(doc.anchors).toEqual([
      { file: 'src/a.ts', symbol: 'run', fingerprint: '0123456789abcdef' },
      { file: 'src/b.ts', symbol: '', fingerprint: 'fedcba9876543210' },
    ])
  })

  it('does not mistake a path with an at sign for a fingerprint', () => {
    // Условие строгое именно ради таких путей: без него node_modules/@abc
    // разобрался бы как отпечаток и отрезал бы кусок пути.
    const doc = parseDocument('a.d2', '# title: X\n# anchors: node_modules/@abc/x.ts:run\n\na -> b\n')
    expect(doc.anchors).toEqual([
      { file: 'node_modules/@abc/x.ts', symbol: 'run', fingerprint: '' },
    ])
  })
})

describe('serializeDocument', () => {
  it('round trips a document without losing anything', () => {
    const doc = parseDocument('docs/logic/status.d2', SOURCE)
    const again = parseDocument('docs/logic/status.d2', serializeDocument(doc))
    expect(again).toEqual(doc)
  })

  it('writes the fingerprint back into the anchor', () => {
    const source = '# title: X\n# anchors: src/a.ts:run@0123456789abcdef\n\na -> b\n'
    expect(serializeDocument(parseDocument('a.d2', source))).toContain(
      '# anchors: src/a.ts:run@0123456789abcdef',
    )
  })

  it('omits the anchors line when there are none', () => {
    const doc = parseDocument('a.d2', '# title: X\n\na -> b\n')
    expect(serializeDocument(doc)).not.toContain('# anchors:')
  })

  it('always ends the file with a newline', () => {
    const doc = parseDocument('a.d2', '# title: X\n\na -> b')
    expect(serializeDocument(doc).endsWith('\n')).toBe(true)
  })
})
