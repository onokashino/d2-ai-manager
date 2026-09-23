import { describe, it, expect } from 'vitest'
// @ts-expect-error модуль браузерный и без типов, тесту хватает значений
import { DICTIONARIES, LANGS } from '../../src/viewer/i18n.js'
// @ts-expect-error то же самое
import { guideSections } from '../../src/viewer/guide-content.js'

type Dict = Record<string, Record<string, string>>
const dicts = DICTIONARIES as Dict
const codes = (LANGS as { code: string }[]).map((l) => l.code)

describe('словари интерфейса', () => {
  it('перечисленные языки существуют', () => {
    expect(Object.keys(dicts).sort()).toEqual([...codes].sort())
  })

  it('во всех языках один и тот же набор ключей', () => {
    const base = Object.keys(dicts.ru ?? {}).sort()
    for (const code of codes) {
      expect({ code, keys: Object.keys(dicts[code] ?? {}).sort() }).toEqual({ code, keys: base })
    }
  })

  it('ни одна строка не пустая', () => {
    for (const [code, table] of Object.entries(dicts)) {
      const empty = Object.entries(table).filter(([, value]) => value.trim() === '')
      expect({ code, empty }).toEqual({ code, empty: [] })
    }
  })

  it('подстановки совпадают между языками', () => {
    // Иначе строка вроде "показано {n} из {all}" в переводе потеряет число, и
    // человек увидит фразу без данных.
    const slots = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const key of Object.keys(dicts.ru ?? {})) {
      const base = slots(dicts.ru?.[key] ?? '')
      for (const code of codes) {
        expect({ key, code, slots: slots(dicts[code]?.[key] ?? '') }).toEqual({ key, code, slots: base })
      }
    }
  })
})

describe('справочник', () => {
  it('разделы и их порядок совпадают между языками', () => {
    const base = guideSections('ru').map((s: { id: string }) => s.id)
    for (const code of codes) {
      expect(guideSections(code).map((s: { id: string }) => s.id)).toEqual(base)
    }
  })

  it('у каждого раздела есть заголовок и хотя бы один блок', () => {
    for (const code of codes) {
      for (const section of guideSections(code)) {
        expect(section.title.trim()).not.toBe('')
        expect(section.blocks.length).toBeGreaterThan(0)
      }
    }
  })

  it('примеры подключают палитру или обходятся без ролей', () => {
    // Пример с ролью, но без импорта палитры, собрался бы серым и сбивал с толку.
    for (const code of codes) {
      for (const section of guideSections(code)) {
        for (const block of section.blocks) {
          if (block.t !== 'example') continue
          if (!/\bclass:\s*(actor|step|choice|store|done|danger|note)\b/.test(block.code)) continue
          expect({ id: section.id, code, hasPalette: block.code.includes('...@_palette') })
            .toEqual({ id: section.id, code, hasPalette: true })
        }
      }
    }
  })
})
