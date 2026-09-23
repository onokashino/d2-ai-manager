import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { toPosix } from '../graph/ids.js'

/**
 * Настройки проекта.
 *
 * Лежат в aimd2.json в корне репозитория, а не в .aimd2 рядом с базой:
 * каталог с базой не отслеживается, а настройки общие для команды и обязаны
 * уехать в репозиторий вместе с кодом. Иначе у каждого будет своя карта, и
 * расхождения документов начнут зависеть от того, чья машина их считала.
 */
export interface ProjectConfig {
  /**
   * Каталоги, которые попадают в карту. Пусто означает весь репозиторий.
   *
   * Главная настройка для монорепозитория: в карте нужен бэкенд, а не
   * фронтенд с тестами, и без этого граф вызовов тонет в чужих связях.
   */
  roots: string[]
  /** Что пропускать сверх .gitignore. Обычные шаблоны ignore. */
  exclude: string[]
  /** Где лежат документы логики. */
  docsDir: string
  /** Дешёвая модель для черновиков. */
  model: string
  studio: {
    /** Поднимать ли студию в начале сессии. */
    autoStart: boolean
    /** Через сколько минут без запросов гасить. Ноль означает никогда. */
    idleMinutes: number
  }
}

export const CONFIG_FILE = 'aimd2.json'

export const DEFAULT_CONFIG: ProjectConfig = {
  roots: [],
  exclude: [],
  docsDir: 'docs/logic',
  model: 'haiku',
  studio: { autoStart: true, idleMinutes: 60 },
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => toPosix(v).replace(/^\.\//, '').replace(/\/+$/, ''))
    .filter(Boolean)
}

/**
 * Читает настройки, подставляя умолчание на каждое пропущенное поле.
 *
 * Испорченный или неполный файл не должен ронять скан: человек правит его
 * руками, и половина настроек в нём это обычное дело. Чужие ключи
 * сохраняются при записи, см. saveConfig.
 */
export function normalizeConfig(raw: unknown): ProjectConfig {
  const input = (raw ?? {}) as Partial<Record<keyof ProjectConfig, unknown>>
  const studio = (input.studio ?? {}) as { autoStart?: unknown; idleMinutes?: unknown }
  const idle = Number(studio.idleMinutes)

  return {
    roots: strings(input.roots),
    exclude: strings(input.exclude),
    docsDir: typeof input.docsDir === 'string' && input.docsDir.trim()
      ? toPosix(input.docsDir).replace(/^\.\//, '').replace(/\/+$/, '')
      : DEFAULT_CONFIG.docsDir,
    model: typeof input.model === 'string' && /^[\w.:-]+$/.test(input.model) ? input.model : DEFAULT_CONFIG.model,
    studio: {
      autoStart: studio.autoStart === undefined ? true : studio.autoStart !== false,
      idleMinutes: Number.isFinite(idle) && idle >= 0 ? idle : DEFAULT_CONFIG.studio.idleMinutes,
    },
  }
}

export async function loadConfig(root: string): Promise<ProjectConfig> {
  try {
    return normalizeConfig(JSON.parse(await readFile(join(root, CONFIG_FILE), 'utf8')))
  } catch {
    // Файла нет или он испорчен: работаем на умолчаниях, как до настройки.
    return { ...DEFAULT_CONFIG, studio: { ...DEFAULT_CONFIG.studio } }
  }
}

/**
 * Пишет настройки, не теряя чужих ключей.
 *
 * Файл лежит в репозитории, и в нём могли появиться поля от будущих версий
 * или от руки. Перезаписать его целиком значило бы молча их выбросить.
 */
export async function saveConfig(root: string, config: ProjectConfig): Promise<void> {
  const path = join(root, CONFIG_FILE)
  let existing: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      existing = parsed as Record<string, unknown>
    }
  } catch {
    // Нечего сохранять: файла не было или он не разбирается.
  }
  await writeFile(path, `${JSON.stringify({ ...existing, ...config }, null, 2)}\n`, 'utf8')
}

/**
 * Стоит ли заходить в каталог.
 *
 * Сам выбранный каталог и всё под ним, плюс те, через которые к нему идёт
 * дорога: чтобы добраться до apps/backend, обойти apps всё равно придётся.
 */
export function mayContain(roots: string[], dir: string): boolean {
  if (roots.length === 0) return true
  return roots.some((r) => r === dir || r.startsWith(`${dir}/`) || dir.startsWith(`${r}/`))
}

/** Попадает ли путь в выбранные каталоги. Пустой список означает весь проект. */
export function withinRoots(roots: string[], rel: string): boolean {
  if (roots.length === 0) return true
  return roots.some((r) => rel === r || rel.startsWith(`${r}/`))
}
