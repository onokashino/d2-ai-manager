/* Компоненты интерфейса без единого нативного контрола: свой выпадающий список
   и свой просмотрщик диаграмм с зумом и перетаскиванием. */

import { icon } from './icons.js'

const CHEVRON = icon('chevron-down', 'chev')
const CHECK = icon('check', 'check')

let openMenu = null

document.addEventListener('click', (e) => {
  if (openMenu && !openMenu.root.contains(e.target)) openMenu.close()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openMenu) openMenu.close()
})

/**
 * Выпадающий список. options это массив {value, label, dot}, где dot это
 * необязательный цвет точки слева от подписи.
 */
export function createSelect(host, { options, value, onChange, placeholder = 'выбрать' }) {
  const root = document.createElement('div')
  root.className = 'select'

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = 'select-trigger'
  trigger.setAttribute('aria-expanded', 'false')

  const label = document.createElement('span')
  label.className = 'select-value'
  trigger.appendChild(label)
  trigger.insertAdjacentHTML('beforeend', CHEVRON)
  root.appendChild(trigger)
  host.replaceChildren(root)

  let current = value
  let menu = null
  let cursor = 0

  const paint = () => {
    const option = options.find((o) => o.value === current)
    label.textContent = option ? option.label : placeholder
    label.classList.toggle('placeholder', !option)
  }

  const close = () => {
    menu?.remove()
    menu = null
    openMenu = null
    trigger.setAttribute('aria-expanded', 'false')
  }

  const pick = (option) => {
    current = option.value
    paint()
    close()
    trigger.focus()
    onChange?.(current)
  }

  const highlight = (index) => {
    if (!menu) return
    cursor = (index + options.length) % options.length
    for (const [i, el] of [...menu.children].entries()) el.classList.toggle('active', i === cursor)
    menu.children[cursor]?.scrollIntoView({ block: 'nearest' })
  }

  const open = () => {
    if (menu) return close()
    openMenu?.close()

    menu = document.createElement('div')
    menu.className = 'select-menu'
    menu.setAttribute('role', 'listbox')

    for (const option of options) {
      const item = document.createElement('div')
      item.className = 'select-option' + (option.value === current ? ' selected' : '')
      item.setAttribute('role', 'option')
      item.innerHTML =
        CHECK +
        (option.dot ? `<span class="dot" style="background:${option.dot}"></span>` : '') +
        `<span>${option.label}</span>`
      item.addEventListener('click', () => pick(option))
      item.addEventListener('mousemove', () => highlight(options.indexOf(option)))
      menu.appendChild(item)
    }

    root.appendChild(menu)
    trigger.setAttribute('aria-expanded', 'true')
    openMenu = { root, close }

    // Если снизу не помещается, список раскрывается вверх.
    const box = menu.getBoundingClientRect()
    if (box.bottom > window.innerHeight - 8) menu.classList.add('up')

    highlight(Math.max(0, options.findIndex((o) => o.value === current)))
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation()
    open()
  })

  trigger.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!menu) return open()
      highlight(cursor + (e.key === 'ArrowDown' ? 1 : -1))
      return
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!menu) return open()
      const option = options[cursor]
      if (option) pick(option)
    }
  })

  paint()
  return {
    get value() { return current },
    set value(next) { current = next; paint() },
  }
}

/**
 * D2 отдаёт svg с одним только viewBox. Внутри абсолютно позиционированного
 * контейнера такой элемент схлопывается и диаграмма выглядит как пустота,
 * поэтому размеры проставляются явно.
 */
export function sizeSvgFromViewBox(stage) {
  const svg = stage.querySelector('svg')
  if (!svg) return
  const box = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (box.length !== 4 || !box[2] || !box[3]) return
  svg.setAttribute('width', String(box[2]))
  svg.setAttribute('height', String(box[3]))
  svg.style.display = 'block'

  // D2 подкладывает под диаграмму сплошной прямоугольник во всю величину.
  // На своём фоне он выглядит вставленной картинкой, поэтому удаляется целиком:
  // снять заливку атрибутом нельзя, внутри svg лежит свой блок стилей, а он
  // сильнее presentation-атрибута.
  for (const rect of svg.querySelectorAll('rect')) {
    if (Math.abs(rect.width.baseVal.value - box[2]) < 2 && Math.abs(rect.height.baseVal.value - box[3]) < 2) {
      rect.remove()
      break
    }
  }

  haloEdgeLabels(svg)
  spreadEdgeLabels(svg)
  shrinkBadges(svg)
  liftTooltips(svg, stage)
}

/**
 * Раздвигает наложившиеся подписи связей.
 *
 * Подпись ставится посередине своей линии, и у двух разных связей эти середины
 * совпадают, если связи идут рядом. Чаще всего так и бывает у одинаковых
 * подписей: два перехода с одним и тем же условием сходятся в один узел. Текст
 * тогда ложится на текст, и прочесть нельзя ни одну из подписей.
 */
function spreadEdgeLabels(svg) {
  const labels = []
  for (const group of svg.querySelectorAll('g')) {
    if (!group.querySelector(':scope > path.connection')) continue
    for (const text of group.querySelectorAll(':scope > text')) labels.push(text)
  }

  const placed = []
  // Сверху вниз: подпись сдвигается только от тех, что уже стоят выше, и
  // порядок обхода не влияет на результат.
  labels.sort((a, b) => a.getBBox().y - b.getBBox().y)

  for (const text of labels) {
    let box = text.getBBox()
    let shift = 0
    for (let guard = 0; guard < 12; guard += 1) {
      const hit = placed.find(
        (p) =>
          box.x < p.x + p.width && p.x < box.x + box.width && box.y < p.y + p.height && p.y < box.y + box.height,
      )
      if (!hit) break
      const step = hit.y + hit.height - box.y + 4
      shift += step
      box = { ...box, y: box.y + step }
    }
    if (shift !== 0) text.setAttribute('y', String(Number(text.getAttribute('y') ?? 0) + shift))
    placed.push(box)
  }
}

/** Во сколько раз уменьшается значок подсказки. D2 рисует его на 32 точки. */
const BADGE = 0.6

/**
 * Уменьшает значок подсказки на узле.
 *
 * D2 рисует его в 32 точки, и рядом с подписью узла он спорит с ней за
 * внимание, хотя дело его скромное: сказать, что у узла есть пояснение.
 *
 * Смещение пересчитывается, иначе масштабирование утащило бы значок к началу
 * координат группы и он уехал бы с места.
 */
function shrinkBadges(svg) {
  for (const badge of svg.querySelectorAll('g.appendix-icon')) {
    const move = /translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)/.exec(badge.getAttribute('transform') ?? '')
    if (!move) continue

    const side = Number(badge.querySelector('svg')?.getAttribute('width') ?? 32)
    const keep = (side - side * BADGE) / 2
    badge.setAttribute('transform', `translate(${Number(move[1]) + keep} ${Number(move[2]) + keep}) scale(${BADGE})`)
  }
}

/**
 * Превращает родную подсказку D2 в свою и ставит её рядом с узлом.
 *
 * D2 кладёт текст подсказки в <title>, то есть отдаёт его браузеру. Родная
 * всплывашка появляется с задержкой почти в секунду, не оформлена и режется
 * краем окна, а объяснение к узлу это как раз то, что читают.
 *
 * Живёт она в неподвижной рамке, а не в самом полотне: полотно таскают и
 * масштабируют, и всё, что лежит внутри, едет и сжимается вместе с ним.
 */
function liftTooltips(svg, stage) {
  const frame = stage.parentElement ?? stage
  let tip = frame.querySelector(':scope > .tip')
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'tip'
    frame.appendChild(tip)
  }

  for (const title of svg.querySelectorAll('title')) {
    const host = title.parentElement
    const text = (title.textContent ?? '').trim()
    title.remove()
    if (!host || !text) continue

    attachTip(stage, host, text)
  }
}

/**
 * Вешает всплывашку на элемент схемы.
 *
 * Отдельно от разбора <title>, потому что подпись нужна и тому, у чего своего
 * title нет: например значку ссылки, который D2 рисует вовсе без пояснения, и
 * человек не знает, куда тот ведёт.
 */
export function attachTip(stage, host, text) {
  const frame = stage.parentElement ?? stage
  let tip = frame.querySelector(':scope > .tip')
  if (!tip) {
    tip = document.createElement('div')
    tip.className = 'tip'
    frame.appendChild(tip)
  }

  host.dataset.tip = text
  host.classList.add('has-tip')
  host.addEventListener('pointerenter', () => {
    tip.textContent = text
    tip.classList.add('on')
    placeTip(tip, host, frame)
  })
  host.addEventListener('pointerleave', () => tip.classList.remove('on'))
}

/**
 * Ставит подсказку сбоку от узла: справа, а если там не помещается, слева.
 *
 * Координаты берутся у самого узла, поэтому масштаб и сдвиг полотна учтены
 * сами собой: getBoundingClientRect отдаёт положение на экране.
 */
function placeTip(tip, host, frame) {
  const node = host.getBoundingClientRect()
  const area = frame.getBoundingClientRect()
  const gap = 12

  let left = node.right - area.left + gap
  if (left + tip.offsetWidth > area.width - gap) left = node.left - area.left - tip.offsetWidth - gap
  left = Math.max(gap, Math.min(left, area.width - tip.offsetWidth - gap))

  let top = node.top - area.top + node.height / 2 - tip.offsetHeight / 2
  top = Math.max(gap, Math.min(top, area.height - tip.offsetHeight - gap))

  tip.style.left = `${left}px`
  tip.style.top = `${top}px`
}

/**
 * Обводит подписи связей цветом фона. Свою линию d2 вырезает маской, но чужая,
 * проходящая мимо, перечёркивает подпись, и та перестаёт читаться. Обводка
 * ставится атрибутами на сам текст, поэтому уезжает вместе с выгруженным svg.
 */
function haloEdgeLabels(svg, colour = '#121212') {
  for (const path of svg.querySelectorAll('path.connection')) {
    for (const text of path.parentElement?.querySelectorAll(':scope > text') ?? []) {
      text.setAttribute('stroke', colour)
      text.setAttribute('stroke-width', '3.5')
      text.setAttribute('stroke-linejoin', 'round')
      text.setAttribute('paint-order', 'stroke fill')
    }
  }
}

/**
 * Просмотрщик диаграммы: колесо масштабирует к курсору, перетаскивание двигает,
 * двойной клик вписывает. Реализован на transform, чтобы не зависеть от d3.
 */
export function createZoomer(viewport, stage) {
  let scale = 1
  let x = 0
  let y = 0
  let dragging = false
  let lastX = 0
  let lastY = 0

  let settle = null
  /**
   * Поднимает полотно в свой слой на время движения и опускает после паузы.
   *
   * Постоянно поднятый слой браузер растрирует один раз и дальше растягивает
   * готовую картинку: тащить его так дешевле, зато на приближении диаграмма
   * становится мыльной. Опущенный слой перерисовывается из самого svg и
   * остаётся резким на любом масштабе.
   */
  const moving = () => {
    stage.style.willChange = 'transform'
    if (settle) clearTimeout(settle)
    settle = setTimeout(() => {
      stage.style.willChange = 'auto'
    }, 220)
  }

  const apply = () => {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
    moving()
    viewport.dispatchEvent(new CustomEvent('zoomchange', { detail: { scale } }))
  }

  const zoomTo = (next, cx, cy) => {
    const clamped = Math.min(6, Math.max(0.08, next))
    const box = viewport.getBoundingClientRect()
    const px = cx - box.left
    const py = cy - box.top
    // Точка под курсором обязана остаться на месте, иначе масштабирование
    // уводит диаграмму в сторону и ею невозможно пользоваться.
    x = px - ((px - x) * clamped) / scale
    y = py - ((py - y) * clamped) / scale
    scale = clamped
    apply()
  }

  // Панели поверх полотна живут своей жизнью: в них скроллят и кликают,
  // а не двигают диаграмму. Без этой проверки колесо в легенде зумило схему.
  const overPanel = (e) => e.target instanceof Element && e.target.closest('[data-overlay]')

  viewport.addEventListener('wheel', (e) => {
    if (overPanel(e)) return
    e.preventDefault()
    zoomTo(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientX, e.clientY)
  }, { passive: false })

  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || overPanel(e)) return
    // Без этого браузер начинает своё выделение и тащит его по всей диаграмме.
    e.preventDefault()
    dragging = true
    lastX = e.clientX
    lastY = e.clientY
    viewport.setPointerCapture(e.pointerId)
    viewport.style.cursor = 'grabbing'
  })
  viewport.addEventListener('pointermove', (e) => {
    if (!dragging) return
    x += e.clientX - lastX
    y += e.clientY - lastY
    lastX = e.clientX
    lastY = e.clientY
    apply()
  })
  const release = (e) => {
    if (!dragging) return
    dragging = false
    try { viewport.releasePointerCapture(e.pointerId) } catch { /* указатель мог уже уйти */ }
    viewport.style.cursor = 'grab'
  }
  viewport.addEventListener('pointerup', release)
  viewport.addEventListener('pointercancel', release)

  const fit = (padding = 40) => {
    const content = stage.firstElementChild
    if (!content) return
    const box = viewport.getBoundingClientRect()
    // Размер берётся при масштабе единица, иначе подгонка зависит от текущего.
    const prev = stage.style.transform
    stage.style.transform = 'none'
    const size = content.getBoundingClientRect()
    stage.style.transform = prev
    if (!size.width || !size.height) return

    scale = Math.min((box.width - padding) / size.width, (box.height - padding) / size.height)
    scale = Math.min(3, Math.max(0.08, scale))
    x = (box.width - size.width * scale) / 2
    y = (box.height - size.height * scale) / 2
    apply()
  }

  viewport.addEventListener('dblclick', (e) => { if (!overPanel(e)) fit() })
  viewport.style.cursor = 'grab'

  return {
    fit,
    zoomIn: () => {
      const box = viewport.getBoundingClientRect()
      zoomTo(scale * 1.25, box.left + box.width / 2, box.top + box.height / 2)
    },
    zoomOut: () => {
      const box = viewport.getBoundingClientRect()
      zoomTo(scale / 1.25, box.left + box.width / 2, box.top + box.height / 2)
    },
    reset: () => { scale = 1; x = 0; y = 0; apply() },
    get scale() { return scale },
  }
}
