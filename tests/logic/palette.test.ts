import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readPalette } from '../../src/logic/palette.js'

const dirs: string[] = []

function workspace(palette?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'aimd2-palette-'))
  dirs.push(root)
  if (palette !== undefined) {
    mkdirSync(join(root, 'docs', 'logic'), { recursive: true })
    writeFileSync(join(root, 'docs', 'logic', '_palette.d2'), palette)
  }
  return root
}

afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true })
})

describe('readPalette', () => {
  it('берёт имя, форму, цвета и подсказку из комментария', async () => {
    const root = workspace(`classes: {
  # Развилка: дальше возможны разные пути.
  choice: {
    shape: diamond
    style: { fill: "#3a2d14"; stroke: "#f5a623" }
  }
}
`)

    expect(await readPalette(root)).toEqual([
      {
        name: 'choice',
        shape: 'diamond',
        hint: 'Развилка: дальше возможны разные пути.',
        fill: '#3a2d14',
        stroke: '#f5a623',
        group: 'Узлы',
      },
    ])
  })

  it('оставляет только первую строку комментария', async () => {
    const root = workspace(`classes: {
  # Кто действует.
  # Эта строка объясняет реализацию и в легенде не нужна.
  actor: { style: { fill: "#16352a"; stroke: "#3ecf8e" } }
}
`)

    const [actor] = await readPalette(root)
    expect(actor?.hint).toBe('Кто действует.')
  })

  it('делит классы на разделы по заголовку из двух решёток', async () => {
    const root = workspace(`classes: {
  # Шаг обработки.
  step: { shape: rectangle }

  ## Связи
  # Ветка ошибки.
  error: { style: { stroke: "#e5484d" } }
}
`)

    const byName = Object.fromEntries((await readPalette(root)).map((c) => [c.name, c.group]))
    expect(byName).toEqual({ step: 'Узлы', error: 'Связи' })
  })

  it('без формы считает класс прямоугольником', async () => {
    const root = workspace(`classes: {
  # Пояснение сбоку.
  note: { style: { stroke: "transparent" } }
}
`)

    expect((await readPalette(root))[0]?.shape).toBe('rectangle')
  })

  it('возвращает пустой список, когда палитры нет', async () => {
    expect(await readPalette(workspace())).toEqual([])
  })
})
