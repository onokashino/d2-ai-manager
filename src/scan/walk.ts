import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import { toPosix } from '../graph/ids.js'
import { DEFAULT_CONFIG, mayContain, withinRoots, type ProjectConfig } from '../logic/config.js'

// .aimd2 это собственный каталог данных инструмента. Без него скан втянул бы
// свою же базу, чей хеш меняется после каждого запуска, и файл пересканировался
// бы вечно. Остальное это каталоги сборки и окружений, содержимое которых
// порождено, а не написано.
const ALWAYS_SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  'coverage',
  'target',
  '__pycache__',
  'venv',
  '.aimd2',
])

interface IgnoreLevel {
  /** Каталог, в котором лежит .gitignore, относительно корня. Пустая строка для корня. */
  base: string
  matcher: Ignore
}

async function loadIgnore(dir: string, base: string): Promise<IgnoreLevel | null> {
  try {
    const matcher = ignore().add(await readFile(join(dir, '.gitignore'), 'utf8'))
    return { base, matcher }
  } catch {
    // .gitignore может отсутствовать, это не ошибка
    return null
  }
}

// Правила читаются снизу вверх: как и в git, побеждает самый глубокий файл,
// поэтому отмена правила через "!" в подкаталоге сильнее запрета сверху.
function isIgnored(levels: IgnoreLevel[], rel: string): boolean {
  for (let i = levels.length - 1; i >= 0; i -= 1) {
    const level = levels[i]!
    const scoped = level.base === '' ? rel : rel.slice(level.base.length + 1)
    const verdict = level.matcher.test(scoped)
    if (verdict.unignored) return false
    if (verdict.ignored) return true
  }
  return false
}

export async function walkFiles(root: string, config: ProjectConfig = DEFAULT_CONFIG): Promise<string[]> {
  const out: string[] = []
  // Свои правила действуют на весь проект и живут рядом с корневым .gitignore.
  const extra: IgnoreLevel[] = config.exclude.length > 0 ? [{ base: '', matcher: ignore().add(config.exclude) }] : []

  async function visit(dir: string, base: string, inherited: IgnoreLevel[]): Promise<void> {
    // .gitignore каждого каталога действует на своё поддерево, как в git.
    // Читался только корневой, и сгенерированный код подпроекта попадал в карту.
    const own = await loadIgnore(dir, base)
    const levels = own ? [...inherited, own] : inherited

    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (ALWAYS_SKIP.has(entry.name)) continue
      const abs = join(dir, entry.name)
      const rel = toPosix(relative(root, abs))
      if (rel === '' || rel.startsWith('..')) continue
      if (isIgnored(levels, entry.isDirectory() ? `${rel}/` : rel)) continue
      if (entry.isDirectory()) {
        // В чужую ветку монорепозитория не заходим вовсе: это и быстрее, и
        // честнее, чем обойти её и потом выбросить.
        if (mayContain(config.roots, rel)) await visit(abs, rel, levels)
      } else if (entry.isFile() && !entry.name.startsWith('.') && withinRoots(config.roots, rel)) {
        out.push(rel)
      }
    }
  }

  await visit(root, '', extra)
  return out.sort()
}
