import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { toPosix } from '../graph/ids.js'

export type Cli = 'claude' | 'codex'

export interface InitResult {
  path: string
  /** Файл уже содержал ровно такие хуки, ничего не переписывали. */
  unchanged: boolean
}

/**
 * Правка файла и команда, которой запускают хук. Claude Code и Codex держат
 * настройки в разных местах и в разном виде, но событие и ответ у них общие,
 * поэтому обе зовут одну и ту же команду.
 */
const TARGETS: Record<Cli, { file: string; editMatcher: string }> = {
  claude: { file: join('.claude', 'settings.json'), editMatcher: 'Edit|Write' },
  // У Codex правка идёт через apply_patch, но он принимает и привычные имена.
  codex: { file: join('.codex', 'hooks.json'), editMatcher: 'apply_patch|Edit|Write' },
}

/**
 * Чем звать хук. По умолчанию глобально поставленным именем, а с флагом
 * абсолютным путём к той сборке, которая прямо сейчас выполняет команду.
 *
 * Подставлять корень проекта сюда нельзя: хук ставят в чужой проект, и его
 * корень к aimd2 отношения не имеет. Раньше так и было, и в чужом проекте
 * получался путь к несуществующему каталогу, а хук молча не срабатывал.
 */
export function hookCommand(local: boolean, entry: string): string {
  if (!local) return 'aimd2 hook'
  // Хук запускают обычным node, поэтому исходник на TypeScript не годится:
  // при запуске из исходников берётся собранный файл рядом.
  const built = entry.endsWith('.ts')
    ? entry.replace(/[\\/]src[\\/]/, '/dist/').replace(/\.ts$/, '.js')
    : entry
  return `node "${toPosix(built)}" hook`
}

function hookBlock(command: string, editMatcher: string): Record<string, unknown> {
  const handler = (timeout: number) => ({ type: 'command', command, timeout })
  return {
    // Начало сессии пересчитывает карту, поэтому срок больше.
    SessionStart: [{ hooks: [handler(60)] }],
    PostToolUse: [{ matcher: editMatcher, hooks: [handler(15)] }],
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(path, 'utf8')
    const value: unknown = JSON.parse(raw)
    return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    // Файла нет или он испорчен. Во втором случае перезапись это потеря чужих
    // настроек, поэтому испорченный файл отличается от отсутствующего выше.
    return {}
  }
}

/** Есть ли в файле уже нечитаемый JSON: переписывать такой вслепую нельзя. */
export async function isBroken(path: string): Promise<boolean> {
  try {
    JSON.parse(await readFile(path, 'utf8'))
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

/**
 * Дописывает хуки в настройки консоли. Чужие ключи сохраняются: файл может
 * содержать права, переменные и что угодно ещё, и затирать это нельзя.
 */
export async function initCli(root: string, cli: Cli, command: string): Promise<InitResult> {
  const target = TARGETS[cli]
  const path = join(root, target.file)

  const current = await readJson(path)
  const hooks = (current.hooks ?? {}) as Record<string, unknown>
  const next = { ...current, hooks: { ...hooks, ...hookBlock(command, target.editMatcher) } }

  const before = JSON.stringify(current)
  const after = JSON.stringify(next)
  if (before === after) return { path: toPosix(target.file), unchanged: true }

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  return { path: toPosix(target.file), unchanged: false }
}

export function cliTarget(cli: Cli): string {
  return toPosix(TARGETS[cli].file)
}
