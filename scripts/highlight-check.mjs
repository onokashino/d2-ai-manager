/* Проверка инварианта редактора: подсвеченный слой обязан посимвольно
   совпадать с исходником, иначе курсор уезжает от видимого текста. */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { highlightD2 } from '../src/viewer/editor.js'

const DOCS = 'docs/logic'

const unpaint = (html) =>
  html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

let bad = 0

for (const name of (await readdir(DOCS)).filter((n) => n.endsWith('.d2'))) {
  const source = await readFile(join(DOCS, name), 'utf8')
  const text = unpaint(highlightD2(source))

  if (text === source) {
    console.log(`OK   ${name}`)
    continue
  }

  bad += 1
  const at = [...source].findIndex((c, i) => c !== text[i])
  console.log(`РАЗОШЛОСЬ ${name} на позиции ${at}`)
  console.log(`  было: ${JSON.stringify(source.slice(Math.max(0, at - 30), at + 20))}`)
  console.log(`  стало: ${JSON.stringify(text.slice(Math.max(0, at - 30), at + 20))}`)
}

console.log(bad === 0 ? 'подсветка ничего не теряет' : `расхождений: ${bad}`)
process.exit(bad === 0 ? 0 : 1)
