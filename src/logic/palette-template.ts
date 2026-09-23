import { copyFile, mkdir, access } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DOCS_DIR } from './library.js'
import { PALETTE_FILE } from './palette.js'

/**
 * Откуда берётся образец палитры. Собранный пакет несёт его в dist, а при
 * запуске из исходников файл лежит там, где он и ведётся, в docs/logic.
 * Один источник на оба случая: копия в коде разошлась бы с настоящей палитрой
 * при первой же правке.
 */
function candidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return [
    join(here, '..', 'templates', PALETTE_FILE),
    join(here, '..', '..', 'docs', 'logic', PALETTE_FILE),
  ]
}

async function readable(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Кладёт палитру в проект, если её там нет. Без неё первый же документ не
 * собирается: шаблон подключает её строкой с тремя точками, а файла нет.
 *
 * Возвращает путь, если файл создан, и пусто, если он уже был.
 */
export async function ensurePalette(root: string, docsDir = DEFAULT_DOCS_DIR): Promise<string> {
  const target = join(root, docsDir, PALETTE_FILE)
  if (await readable(target)) return ''

  for (const source of candidates()) {
    if (!(await readable(source))) continue
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    return `${docsDir}/${PALETTE_FILE}`
  }
  return ''
}
