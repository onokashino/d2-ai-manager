import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'

/**
 * Запись о поднятой студии.
 *
 * Лежит рядом с базой, потому что привязана к проекту, а не к машине: у
 * каждого проекта своя студия и свой порт. Без неё вторая сессия того же
 * проекта поднимала бы второй сервер на соседнем порту, и человек не знал бы,
 * какую из двух вкладок смотреть.
 */
export interface StudioRecord {
  port: number
  url: string
  pid: number
  startedAt: string
}

export function lockPath(root: string): string {
  return join(root, '.aimd2', 'studio.json')
}

export async function readLock(root: string): Promise<StudioRecord | null> {
  try {
    return JSON.parse(await readFile(lockPath(root), 'utf8')) as StudioRecord
  } catch {
    // Записи нет или она испорчена: считаем, что студия не поднята.
    return null
  }
}

export async function writeLock(root: string, record: StudioRecord): Promise<void> {
  const path = lockPath(root)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

export async function clearLock(root: string): Promise<void> {
  await rm(lockPath(root), { force: true })
}

/**
 * Отвечает ли кто-нибудь по этому адресу.
 *
 * Проверяется живой ответ, а не существование записи: процесс мог умереть,
 * не убрав её за собой, например при выключении машины.
 */
export async function aliveAt(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return res.ok
  } catch {
    return false
  }
}

/** Первый свободный порт начиная с указанного. */
export async function freePort(from: number, tries = 40): Promise<number> {
  for (let port = from; port < from + tries; port += 1) {
    const taken = await new Promise<boolean>((resolve) => {
      const probe = createServer()
      probe.once('error', () => resolve(true))
      probe.once('listening', () => probe.close(() => resolve(false)))
      probe.listen(port, '127.0.0.1')
    })
    if (!taken) return port
  }
  // Ни одного свободного в диапазоне: пусть ядро выберет само.
  return 0
}
