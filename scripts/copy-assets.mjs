/* Разметка, стили и браузерные модули вьювера рядом с серверным кодом, но tsc
   их не трогает: он умеет только собирать TypeScript. Без этого шага собранная
   студия не открывалась, потому что искала library.html рядом с server.js. */
import { readdir, mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const FROM = 'src/viewer'
const TO = 'dist/viewer'
const KEEP = /\.(html|css|js)$/

const names = (await readdir(FROM)).filter((n) => KEEP.test(n))
await mkdir(TO, { recursive: true })

for (const name of names) await copyFile(join(FROM, name), join(TO, name))

// Палитра это образец для новых проектов: без неё первый же документ там не
// собирается. Берётся та же, что ведётся в docs/logic, чтобы не разошлись.
await mkdir('dist/templates', { recursive: true })
await copyFile('docs/logic/_palette.d2', 'dist/templates/_palette.d2')

console.log(`скопировано файлов вьювера: ${names.length}, плюс образец палитры`)
