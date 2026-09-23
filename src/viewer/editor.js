/* Редактор D2: подсветка, нумерация строк, подсказки и автозакрытие скобок.
   Собран на текстовом поле с подсвеченным слоем под ним, без внешних
   библиотек: язык маленький, а сборки в проекте нет. */

const esc = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

const KEYWORDS = new Set([
  'shape', 'style', 'class', 'classes', 'vars', 'direction', 'label', 'icon',
  'link', 'tooltip', 'near', 'width', 'height', 'constraint', 'grid-rows',
  'grid-columns', 'grid-gap', 'layers', 'scenarios', 'steps', 'fill', 'stroke',
  'stroke-width', 'stroke-dash', 'opacity', 'shadow', 'font-color', 'font-size',
  'bold', 'italic', 'border-radius', 'double-border', 'multiple', 'animated',
  '3d', 'text-transform', 'd2-config', 'layout-engine',
])

const TAIL = /(\{|\})|(\b(?:class|shape|style)\b)|(:)|("[^"]*")|(#[0-9a-fA-F]{3,8})|(\|{1,3}[a-z]*)/g

/**
 * Раскрашивает хвост строки, не теряя ни одного символа: всё, что не попало
 * под правило, уходит в вывод экранированным как есть.
 */
function paintTail(text) {
  let out = ''
  let last = 0

  for (const m of text.matchAll(TAIL)) {
    out += esc(text.slice(last, m.index))
    const [all, brace, kw, colon, str, colour, block] = m
    if (brace) out += `<span class="t-punct">${brace}</span>`
    else if (kw) out += `<span class="t-keyword">${kw}</span>`
    else if (colon) out += `<span class="t-punct">:</span>`
    else if (str) out += `<span class="t-string">${esc(str)}</span>`
    else if (colour) out += `<span class="t-colour">${esc(colour)}</span>`
    else if (block) out += `<span class="t-block">${esc(block)}</span>`
    last = m.index + all.length
  }

  return out + esc(text.slice(last))
}

/**
 * Подсвечивает одну строку. Блочные строки вида |md ... | обрабатываются
 * снаружи: внутри них разметки нет, там обычный текст.
 *
 * Важное правило: текст подсвеченной строки обязан посимвольно совпадать с
 * исходной. Поле ввода лежит поверх этого слоя прозрачным текстом, и любой
 * добавленный или съеденный пробел уводит курсор от того, что видно.
 */
function highlightLine(line) {
  const comment = /^(\s*)(#.*)$/.exec(line)
  if (comment) return `${comment[1]}<span class="t-comment">${esc(comment[2])}</span>`

  const importLine = /^(\s*)(\.\.\.@[\w./-]+)(.*)$/.exec(line)
  if (importLine) {
    return `${importLine[1]}<span class="t-import">${esc(importLine[2])}</span>${esc(importLine[3])}`
  }

  // Ведущие пробелы сохраняются как есть, иначе поплывут отступы.
  const indent = /^\s*/.exec(line)[0]
  let out = indent
  let rest = line.slice(indent.length)

  // Связь: две стороны, пробелы вокруг стрелки переносятся без правки.
  const arrow = /^([\w.Ѐ-ӿ-]+(?:[ \t]+[\w.Ѐ-ӿ-]+)*?)([ \t]*)(<->|->|<-|--)([ \t]*)([\w.Ѐ-ӿ-]+)/.exec(rest)
  if (arrow) {
    out += `<span class="t-node">${esc(arrow[1])}</span>${esc(arrow[2])}`
    out += `<span class="t-arrow">${esc(arrow[3])}</span>${esc(arrow[4])}`
    out += `<span class="t-node">${esc(arrow[5])}</span>`
    rest = rest.slice(arrow[0].length)
  } else {
    const key = /^([\w.Ѐ-ӿ-]+)([ \t]*):/.exec(rest)
    if (key) {
      const cls = KEYWORDS.has(key[1]) ? 't-keyword' : 't-key'
      out += `<span class="${cls}">${esc(key[1])}</span>${esc(key[2])}<span class="t-punct">:</span>`
      rest = rest.slice(key[0].length)
    }
  }

  return out + paintTail(rest)
}

export function highlightD2(code) {
  const out = []
  let inBlock = false

  for (const line of code.split('\n')) {
    if (inBlock) {
      out.push(`<span class="t-text">${esc(line)}</span>`)
      if (/^\s*\|{1,3}/.test(line)) inBlock = false
      continue
    }
    // Блок открывается вертикальной чертой и закрывается такой же на своей строке.
    if (/\|{1,3}[a-z]*\s*$/.test(line)) inBlock = true
    out.push(highlightLine(line))
  }

  return out.join('\n')
}

const ID = '[\\w.\\u0400-\\u04FF-]'

/** Слово перед курсором, чтобы фильтровать подсказки. */
function currentWord(value, caret) {
  const match = new RegExp(`(${ID}*)$`).exec(value.slice(0, caret))
  return match ? match[1] : ''
}

/** Ключи, уместные внутри блока style. */
const STYLE_KEYS = [
  'fill', 'stroke', 'stroke-width', 'stroke-dash', 'opacity', 'shadow',
  'font-color', 'font-size', 'bold', 'italic', 'underline', 'border-radius',
  'double-border', 'multiple', 'animated', '3d', 'text-transform', 'fill-pattern',
]

/**
 * Готовые куски документа. Курсор встаёт туда, где стоит знак доллара: обычно
 * это название, которое всё равно придётся набрать своими словами.
 *
 * Подписи приходят снаружи через переводчик: название заготовки это интерфейс
 * и переводится, а вставляемый код одинаков на всех языках.
 */
const snippets = (t) => [
  { name: t('editor.snipPalette'), hint: t('editor.snipPaletteHint'),
    insert: '...@_palette\n$' },
  { name: t('editor.snipStep'), hint: t('editor.snipStepHint'),
    insert: '$: Name { class: step }' },
  { name: t('editor.snipActor'), hint: t('editor.snipActorHint'),
    insert: '$: Name { class: actor }' },
  { name: t('editor.snipChoice'), hint: t('editor.snipChoiceHint'),
    insert: '$: Condition? { class: choice }\n$ -> yes_branch: yes\n$ -> no_branch: no { class: error }' },
  { name: t('editor.snipStore'), hint: t('editor.snipStoreHint'),
    insert: '$: Name { class: store }' },
  { name: t('editor.snipLink'), hint: t('editor.snipLinkHint'),
    insert: '$ -> target: label' },
  { name: t('editor.snipGroup'), hint: t('editor.snipGroupHint'),
    insert: '$: Name {\n  first: First step { class: step }\n  second: Second step { class: step }\n  first -> second\n}' },
  { name: t('editor.snipNote'), hint: t('editor.snipNoteHint'),
    insert: '$: |md\n  **Title**\n\n  Explanation.\n| { class: note }' },
  { name: t('editor.snipTable'), hint: t('editor.snipTableHint'),
    insert: '$: {\n  shape: sql_table\n  id: int { constraint: primary_key }\n  name: string\n}' },
  { name: t('editor.snipSeq'), hint: t('editor.snipSeqHint'),
    insert: '$: {\n  shape: sequence_diagram\n  a: One side\n  b: Other side\n  a -> b: request\n  b -> a: response\n}' },
  { name: t('editor.snipDocLink'), hint: t('editor.snipDocLinkHint'),
    insert: '$: Name { class: artifact; link: /d/docs/logic/other.d2 }' },
]

/**
 * Узлы, уже объявленные в документе. Подсказка по ним нужна чаще всего: связи
 * пишутся по именам, а имена короткие и легко забываются.
 */
function collectNodes(value, t) {
  const found = new Map()
  const stack = []
  let inBlock = false

  for (const raw of value.split('\n')) {
    if (inBlock) {
      if (/^\s*\|{1,3}/.test(raw)) inBlock = false
      continue
    }
    if (/\|{1,3}[a-z]*\s*$/.test(raw)) { inBlock = true; continue }

    const line = raw.replace(/#.*$/, '')
    const indent = /^\s*/.exec(line)[0].length
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()

    const m = new RegExp(`^\\s*(${ID}+)\\s*:\\s*(.*)$`).exec(line)
    if (!m) {
      if (/\}/.test(line)) stack.pop()
      continue
    }

    const [, id, tail] = m
    // Служебные ключи это не узлы, подставлять их в связь бессмысленно.
    if (KEYWORDS.has(id) || STYLE_KEYS.includes(id)) continue

    const path = [...stack.map((s) => s.id), id].join('.')
    const label = tail.replace(/\{.*$/, '').trim()
    if (!found.has(path)) found.set(path, { name: path, hint: label || t('editor.node') })
    if (/\{\s*$/.test(tail)) stack.push({ id, indent })
  }

  return [...found.values()]
}

/** Что уместно подсказать в этой позиции. */
function suggestionsFor(value, caret, { classes, shapes, keywords, t }) {
  const line = value.slice(value.lastIndexOf('\n', caret - 1) + 1, caret)
  const tag = (items, kind) => items.map((i) => ({ kind, ...i }))

  if (new RegExp(`\\bclass\\s*:\\s*${ID}*$`).test(line)) return tag(classes, t('editor.kindRole'))
  if (new RegExp(`\\bshape\\s*:\\s*${ID}*$`).test(line)) {
    return tag(shapes.map((s) => ({ name: s, hint: '' })), t('editor.kindShape'))
  }

  // После стрелки идёт имя узла, и почти всегда уже существующего.
  if (new RegExp(`(->|<-|<->|--)\\s*${ID}*$`).test(line)) {
    return tag(collectNodes(value, t), t('editor.kindNode'))
  }

  // Внутри style подсказываются ключи оформления, а не язык целиком.
  const before = value.slice(Math.max(0, caret - 600), caret)
  const styleAt = before.lastIndexOf('style')
  if (styleAt !== -1) {
    const after = before.slice(styleAt)
    const open = (after.match(/\{/g) ?? []).length
    const close = (after.match(/\}/g) ?? []).length
    if (open > close) return tag(STYLE_KEYS.map((k) => ({ name: k, hint: '' })), t('editor.kindStyle'))
  }

  // Начало строки: либо новый узел из заготовки, либо связь от существующего.
  if (new RegExp(`^\\s*${ID}*$`).test(line)) {
    return [...tag(snippets(t), t('editor.kindBlock')), ...tag(collectNodes(value, t), t('editor.kindNode'))]
  }

  return tag(keywords.map((k) => ({ name: k, hint: '' })), t('editor.kindKey'))
}

export function createEditor(host, options) {
  const {
    value = '', onInput, onSave, classes = [], shapes = [], keywords = [],
    // Без переводчика редактор всё равно работает: подписи станут ключами,
    // но подсказки и вставка не сломаются.
    t = (key) => key,
  } = options

  host.classList.add('editor')
  host.innerHTML = `
    <div class="editor-gutter" aria-hidden="true"></div>
    <div class="editor-body">
      <pre class="editor-paint" aria-hidden="true"><code></code></pre>
      <textarea class="editor-input" spellcheck="false" autocomplete="off"></textarea>
      <div class="editor-hints" hidden></div>
    </div>`

  const gutter = host.querySelector('.editor-gutter')
  const paint = host.querySelector('.editor-paint code')
  const input = host.querySelector('.editor-input')
  const hints = host.querySelector('.editor-hints')

  let errorLines = new Set()
  let hintItems = []
  let hintIndex = 0

  // Шрифт моноширинный, поэтому место курсора считается по ширине знака.
  // Замер делается по требованию: до загрузки шрифта цифры были бы другими.
  const metrics = () => {
    const css = getComputedStyle(input)
    const probe = document.createElement('span')
    probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${css.font}`
    probe.textContent = '0'.repeat(50)
    host.append(probe)
    const charWidth = probe.getBoundingClientRect().width / 50
    probe.remove()
    return { charWidth, lineHeight: parseFloat(css.lineHeight) || 20 }
  }

  const paintAll = () => {
    paint.innerHTML = highlightD2(input.value) + '\n'
    const count = input.value.split('\n').length
    gutter.innerHTML = Array.from({ length: count }, (_, i) => {
      const n = i + 1
      return `<div class="${errorLines.has(n) ? 'line bad' : 'line'}">${n}</div>`
    }).join('')
  }

  const syncScroll = () => {
    paint.parentElement.scrollTop = input.scrollTop
    paint.parentElement.scrollLeft = input.scrollLeft
    gutter.scrollTop = input.scrollTop
  }

  const closeHints = () => {
    hints.hidden = true
    hintItems = []
  }

  const applyHint = (item) => {
    const caret = input.selectionStart
    const word = currentWord(input.value, caret)
    const from = caret - word.length

    const lineStart = input.value.lastIndexOf('\n', from - 1) + 1
    const indent = /^[ \t]*/.exec(input.value.slice(lineStart, from))[0]
    // Заготовка вставляется с отступом текущей строки, иначе вложенный блок
    // прилипает к левому краю и его приходится двигать руками.
    const body = (item.insert ?? item.name).split('\n').join(`\n${indent}`)

    const at = body.indexOf('$')
    const text = at === -1 ? body : body.replace('$', '')
    input.value = input.value.slice(0, from) + text + input.value.slice(caret)
    input.selectionStart = input.selectionEnd = from + (at === -1 ? text.length : at)

    closeHints()
    paintAll()
    onInput?.(input.value)
  }

  const showHints = (forced = false) => {
    const caret = input.selectionStart
    const pool = suggestionsFor(input.value, caret, { classes, shapes, keywords, t })
    const word = currentWord(input.value, caret).toLowerCase()

    const starts = pool.filter((i) => i.name.toLowerCase().startsWith(word))
    // Совпадение в середине имени тоже показывается, но ниже точных: так
    // короткий обрывок слова всё равно находит нужное.
    const inside = pool.filter((i) => !i.name.toLowerCase().startsWith(word) && i.name.toLowerCase().includes(word))
    hintItems = [...starts, ...(word ? inside : [])].slice(0, 9)

    if (hintItems.length === 0) return closeHints()
    // Пустой список ключей языка при пустом слове это шум: он лезет после
    // каждого пробела. Роли, узлы и заготовки наоборот полезны сразу.
    if (!forced && !word && hintItems.every((i) => i.kind === t('editor.kindKey'))) return closeHints()

    hintIndex = 0
    hints.innerHTML = hintItems
      .map((i, n) => `
        <div class="hint ${n === 0 ? 'on' : ''}" data-n="${n}">
          <span class="hint-name">${esc(i.name)}</span>
          <span class="hint-kind">${esc(i.shape || i.kind || '')}</span>
          ${i.hint ? `<span class="hint-text">${esc(i.hint)}</span>` : ''}
        </div>`)
      .join('')
    hints.hidden = false

    // Панель ставится под курсором: строка даёт вертикаль, колонка горизонталь.
    const { charWidth, lineHeight } = metrics()
    const before = input.value.slice(0, caret)
    const line = before.split('\n').length
    const column = caret - before.lastIndexOf('\n') - 1

    const below = 14 + line * lineHeight - input.scrollTop + 4
    const area = input.clientHeight
    // У нижнего края панель раскрывается вверх, иначе список уезжает за экран.
    hints.style.top = below + hints.offsetHeight > area
      ? `${Math.max(4, below - lineHeight - hints.offsetHeight - 8)}px`
      : `${below}px`

    const left = Math.max(4, 16 + column * charWidth - input.scrollLeft)
    hints.style.left = `${Math.min(left, Math.max(4, input.clientWidth - hints.offsetWidth - 8))}px`

    for (const el of hints.querySelectorAll('.hint')) {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        applyHint(hintItems[Number(el.dataset.n)])
      })
    }
  }

  const moveHint = (delta) => {
    hintIndex = (hintIndex + delta + hintItems.length) % hintItems.length
    for (const [n, el] of [...hints.children].entries()) el.classList.toggle('on', n === hintIndex)
  }

  input.addEventListener('input', () => {
    paintAll()
    showHints()
    onInput?.(input.value)
  })
  input.addEventListener('scroll', syncScroll)
  input.addEventListener('blur', closeHints)

  input.addEventListener('keydown', (e) => {
    if (!hints.hidden) {
      if (e.key === 'ArrowDown') { e.preventDefault(); return moveHint(1) }
      if (e.key === 'ArrowUp') { e.preventDefault(); return moveHint(-1) }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return applyHint(hintItems[hintIndex])
      }
      if (e.key === 'Escape') { e.preventDefault(); return closeHints() }
    }

    if (e.key === ' ' && e.ctrlKey) {
      // По Ctrl+Space список показывается целиком, даже когда ничего не набрано.
      e.preventDefault()
      return showHints(true)
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      return onSave?.()
    }

    if (e.key === 'Tab') {
      // Табом набирают отступ, а не уходят с поля: это редактор кода.
      e.preventDefault()
      const { selectionStart: a, selectionEnd: b } = input
      input.value = `${input.value.slice(0, a)}  ${input.value.slice(b)}`
      input.selectionStart = input.selectionEnd = a + 2
      paintAll()
      return onInput?.(input.value)
    }

    if (e.key === '{') {
      e.preventDefault()
      const { selectionStart: a, selectionEnd: b } = input
      input.value = `${input.value.slice(0, a)}{  }${input.value.slice(b)}`
      input.selectionStart = input.selectionEnd = a + 2
      paintAll()
      return onInput?.(input.value)
    }
  })

  input.value = value
  paintAll()

  return {
    get value() { return input.value },
    set value(next) { input.value = next; paintAll() },
    focus: () => input.focus(),
    /** Подсвечивает строки, на которые ругнулся компилятор. */
    markErrors(lines) {
      errorLines = new Set(lines)
      paintAll()
    },
    /** Прокручивает к строке и ставит туда курсор. */
    goToLine(line) {
      const offset = input.value.split('\n').slice(0, line - 1).join('\n').length
      input.focus()
      input.selectionStart = input.selectionEnd = Math.min(offset + 1, input.value.length)
      input.scrollTop = Math.max(0, (line - 4) * metrics().lineHeight)
      syncScroll()
    },
  }
}
