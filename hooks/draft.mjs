#!/usr/bin/env node
import { spawn } from 'node:child_process'

// Событие конца хода: агент ответил, работа закончена, можно спокойно писать
// документ по тому, что произошло. Выбран именно конец хода, а не правка
// файла: посреди работы ход мыслей ещё не сложился, и черновик пришлось бы
// переписывать после каждого движения.

const exit = () => process.exit(0)

// Запущенная нами же консоль сама дойдёт до конца хода и позвала бы себя
// заново. Метка в окружении рвёт эту петлю.
if (process.env.AIMD2_BACKGROUND) exit()

let raw = ''
try {
  for await (const chunk of process.stdin) raw += chunk
} catch {
  exit()
}

let event
try {
  event = JSON.parse(raw)
} catch {
  exit()
}

// Консоль повторно зовёт хук конца хода, когда предыдущий её остановил.
// Второй заход про тот же ход нам не нужен.
if (!event || event.stop_hook_active) exit()

const session = String(event.session_id ?? '')
const cwd = String(event.cwd ?? '')
// Оба значения уезжают в строку команды. Всё, что не похоже на идентификатор
// и на обычный путь, отбрасывается целиком, а не экранируется наполовину.
if (!/^[\w-]+$/.test(session) || !cwd || /["`$\n]/.test(cwd)) exit()

spawn(`aimd2 draft --session ${session} --path "${cwd}"`, {
  shell: true,
  // Работа идёт минутами, а сессия ждать не должна: процесс отвязывается и
  // живёт сам. Вывод выбрасывается, потому что читать его некому.
  detached: true,
  stdio: 'ignore',
  env: { ...process.env, AIMD2_BACKGROUND: '1' },
}).unref()

exit()
