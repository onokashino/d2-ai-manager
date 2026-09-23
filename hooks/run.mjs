#!/usr/bin/env node
import { spawn } from 'node:child_process'

// Консоль, запущенную нами для черновика, хуки касаться не должны: она пошла
// бы по тому же кругу и позвала бы себя заново.
if (process.env.AIMD2_BACKGROUND) process.exit(0)

// Плагин поставляет скилл и хуки, движок ставится отдельно: npm i -g aimd2.
// Пока его нет, хук обязан молчать: сломанное напоминание хуже отсутствующего.
// Поэтому вывод ребёнка не наследуется, а собирается, и наружу идёт только то,
// что консоль действительно должна показать.
// Команда идёт одной строкой, а не именем с массивом аргументов: со включённой
// оболочкой второе даёт предупреждение DEP0190, и оно село бы в поток ошибок
// хука при каждом вызове. Строка здесь постоянная, подставлять в неё нечего.
const child = spawn('aimd2 hook', {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: true,
})

let out = ''
let err = ''
child.stdout.on('data', (chunk) => {
  out += chunk
})
child.stderr.on('data', (chunk) => {
  err += chunk
})

const quit = () => process.exit(0)
child.on('error', quit)
child.stdin.on('error', quit)

child.on('close', (code) => {
  // Код два это единственный ответ, который консоль показывает модели, и он
  // приходит потоком ошибок. Ноль отдаёт контекст начала сессии. Всё
  // остальное, включая ненайденную команду, гасится.
  if (code === 2) {
    process.stderr.write(err)
    process.exit(2)
  }
  if (code === 0 && out !== '') process.stdout.write(out)
  process.exit(0)
})

process.stdin.pipe(child.stdin)
