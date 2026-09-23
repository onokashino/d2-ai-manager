/* Мелочи, общие для страниц: статусы, ссылки на документы, экранирование. */

export const STATUS_LIST = ['approved', 'review', 'draft', 'outdated']
export const STATUS_DOT = {
  approved: 'var(--brand)',
  review: 'var(--amber)',
  draft: 'var(--fg-subtle)',
  outdated: 'var(--red)',
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** Адрес страницы документа. Путь идёт как есть, чтобы ссылка читалась глазами. */
export const docHref = (path) => '/d/' + path.split('/').map(encodeURIComponent).join('/')

/**
 * Настройка, которая переживает перезагрузку. Список допустимых значений
 * обязателен: в хранилище может лежать что угодно, от старой версии студии до
 * правки руками, и подставлять это в запрос нельзя.
 *
 * Приватный режим умеет запрещать хранилище, поэтому обе стороны молчаливо
 * откатываются к значению по умолчанию, а не роняют страницу.
 */
export function remembered(key, allowed, fallback) {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value) ? value : fallback
  } catch {
    return fallback
  }
}

export function remember(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Не сохранилось, текущая страница всё равно работает с выбранным значением.
  }
}
