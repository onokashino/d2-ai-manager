import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { renderDiagram, closeRenderer } from '../src/logic/render.ts'

// Проверяет, что каждый документ логики компилируется. Идёт через тот же
// renderDiagram, что и студия, иначе проверка подтверждала бы не то, что
// человек увидит в браузере. Скрипт отдельный, а не тест: воркер D2 держит
// событийный цикл и процесс приходится закрывать руками.
const dir = process.argv[2] ?? 'docs/logic'
const names = (await readdir(dir)).filter((n) => n.endsWith('.d2'))

const stripHeader = (text) =>
  text.split(/\r?\n/).filter((l) => !/^#\s*[a-zA-Z_][\w-]*\s*:/.test(l)).join('\n')

// Соседи нужны для строки `...@_palette`: документ видит их по имени файла.
const neighbours = {}
for (const name of names) neighbours[name] = stripHeader(await readFile(join(dir, name), 'utf8'))

let bad = 0
for (const name of names) {
  // Палитра сама по себе не диаграмма, её проверяют документы, которые её тянут.
  if (name.startsWith('_')) continue

  const result = await renderDiagram(neighbours[name], 'dagre', 'dark', neighbours)
  if (result.ok) {
    console.log(`OK   ${name}  ${Math.round(result.svg.length / 1024)} КБ`)
    continue
  }

  bad += 1
  const errors = result.errors.map((e) => `${e.line}:${e.column} ${e.message}`).join('\n     ')
  console.log(`FAIL ${name}\n     ${errors}`)
}

await closeRenderer()
console.log(bad === 0 ? 'все документы компилируются' : `не компилируется: ${bad}`)
process.exit(bad === 0 ? 0 : 1)
