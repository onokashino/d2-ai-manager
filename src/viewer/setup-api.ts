import { walkFiles } from '../scan/walk.js'
import { loadConfig, saveConfig, normalizeConfig, type ProjectConfig } from '../logic/config.js'
import { toPosix } from '../graph/ids.js'

export interface TreeEntry {
  path: string
  /** Сколько файлов лежит в этом каталоге и под ним. */
  files: number
  /** Глубина от корня: первый уровень это 1. */
  depth: number
}

export interface SetupView {
  root: string
  config: ProjectConfig
  tree: TreeEntry[]
}

const MAX_DEPTH = 2

/**
 * Каталоги проекта с числом файлов, до второго уровня.
 *
 * Обход идёт с пустым списком корней, а не с текущим: страница настройки
 * обязана показывать и то, что сейчас исключено, иначе включить обратно
 * выключенный каталог было бы неоткуда.
 *
 * Глубже второго уровня не спускаемся намеренно: выбор из сотен строк это не
 * выбор, а на втором уровне уже видно и apps/backend, и packages/money.
 */
export async function projectTree(root: string, config: ProjectConfig): Promise<TreeEntry[]> {
  const files = await walkFiles(root, { ...config, roots: [] })
  const counts = new Map<string, number>()

  for (const file of files) {
    const parts = file.split('/')
    for (let depth = 1; depth <= Math.min(MAX_DEPTH, parts.length - 1); depth += 1) {
      const dir = parts.slice(0, depth).join('/')
      counts.set(dir, (counts.get(dir) ?? 0) + 1)
    }
  }

  return [...counts]
    .map(([path, files]) => ({ path, files, depth: path.split('/').length }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export async function setupView(root: string): Promise<SetupView> {
  const config = await loadConfig(root)
  return { root: toPosix(root), config, tree: await projectTree(root, config) }
}

/** Принимает настройки от страницы и кладёт их в файл проекта. */
export async function applySetup(root: string, raw: unknown): Promise<ProjectConfig> {
  const config = normalizeConfig(raw)
  await saveConfig(root, config)
  return config
}
