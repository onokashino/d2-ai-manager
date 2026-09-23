/* Локализация интерфейса. Документы логики сюда не попадают: их пишет агент
   на одном языке, и переводить содержимое карты никто не обещал. Здесь только
   подписи, кнопки и тексты самой студии. */

export const LANGS = [
  { code: 'ru', label: 'Русский' },
  { code: 'en', label: 'English' },
]

const KEY = 'aimd2-lang'
const FALLBACK = 'ru'

const DICT = {
  ru: {
    'app.name': 'Карта логики',
    'app.tag': 'D2 STUDIO',

    'nav.library': 'Библиотека',
    'nav.guide': 'Справочник',
    'nav.codemap': 'Карта кода',
    'nav.lang': 'Язык',

    'action.open': 'Открыть',
    'action.save': 'Сохранить',
    'action.downloadSvg': 'Скачать SVG',
    'action.zoomIn': 'Приблизить',
    'action.zoomOut': 'Отдалить',
    'action.fit': 'Вписать',
    'action.reload': 'Обновить',
    'action.copy': 'Скопировать',
    'action.copied': 'Скопировано',

    'library.title': 'Библиотека логики',
    'library.pageTitle': 'Библиотека логики',
    'library.search': 'поиск',
    'library.searchPlaceholder': 'заголовок, файл, описание',
    'library.status': 'статус',
    'library.area': 'область',
    'library.sync': 'сверка с кодом',
    'library.total': 'документов',
    'library.colDoc': 'документ',
    'library.colArea': 'область',
    'library.colStatus': 'статус',
    'library.showing': 'показано {n} из {all}',
    'library.allStatuses': 'все статусы',
    'library.allAreas': 'все области',
    'library.allDocs': 'все документы',
    'library.onlyBroken': 'разошедшиеся',
    'library.onlyClean': 'целые',
    'library.diverged': 'разошёлся: {n}',
    'library.drifted': 'код изменился: {n}',
    'library.byHuman': 'сверен человеком',
    'library.notConfirmed': 'читал только агент',
    'library.emptyTitle': 'Документов логики пока нет.',
    'library.emptyWhere': 'Они живут в {dir} как файлы {ext}.',
    'library.emptyHow': 'Создать первый:',

    'doc.pageTitle': 'Документ логики',
    'doc.tabCode': 'Код',
    'doc.tabProps': 'Свойства',
    'doc.fieldTitle': 'Заголовок',
    'doc.fieldArea': 'Область',
    'doc.fieldSummary': 'Описание',
    'doc.summaryPlaceholder': 'Одно-два предложения: по ним документ узнают в списке',
    'doc.summaryHint': 'В шапке файла описание живёт одной строкой, переносы склеятся при сохранении.',
    'doc.anchors': 'якоря в коде',
    'doc.noAnchors': 'не привязан к коду',
    'doc.anchorOk': 'цел',
    'doc.anchorNoFile': 'файла нет',
    'doc.anchorNoSymbol': 'символа нет',
    'doc.anchorDrifted': 'код переписали',
    'doc.flow': 'ход через код',
    'doc.flowOk': 'переход есть',
    'doc.flowStepGone': 'шага нет в карте',
    'doc.flowLinkGone': 'перехода не видно',
    'doc.linkBoard': 'Открыть доску: {name}',
    'doc.linkDoc': 'Перейти: {where}',
    'doc.linkGone': 'Ссылка никуда не ведёт: {where}',
    'doc.sealHint': 'Отпечаток ставится командой aimd2 logic seal: она говорит, что документ сверили с кодом.',
    'doc.confirm': 'Сверено',
    'doc.confirmHint': 'Я прочитал код и документ, сейчас они сходятся',
    'doc.confirmed': 'сверено',
    'doc.checkedHuman': 'Документ сверял человек.',
    'doc.checkedAgent': 'Документ сверял только агент, человек его не читал.',
    'doc.checkedNever': 'Документ ни разу не сверяли с кодом.',
    'doc.legend': 'Легенда',
    'doc.boardRoot': 'основа',
    'doc.board.steps': 'шаг',
    'doc.board.scenarios': 'ветка',
    'doc.board.layers': 'слой',
    'doc.boardPrev': 'Предыдущая доска',
    'doc.boardNext': 'Следующая доска',
    'doc.stateTyping': 'набор',
    'doc.stateDrawing': 'рисую',
    'doc.stateUnsaved': 'не сохранено',
    'doc.stateSaved': 'сохранено',
    'doc.stateErrors': 'ошибок: {n}',
    'doc.notFound': 'Документ не открывается: {path}',
    'doc.toLibrary': 'К библиотеке',

    'guide.pageTitle': 'Справочник D2',
    'guide.title': 'Справочник D2',
    'guide.lead': 'Как описывать логику диаграммой: синтаксис языка и правила этого проекта, с живыми примерами.',
    'guide.contents': 'разделы',
    'guide.result': 'что получится',
    'guide.rendering': 'рисую',
    'guide.failed': 'пример не собрался',
    'guide.tryIt': 'Открыть в редакторе',
    'guide.paletteRoles': 'Роли из палитры проекта',
    'guide.roleName': 'класс',
    'guide.roleShape': 'форма',
    'guide.roleWhen': 'когда',

    'editor.kindRole': 'роль',
    'editor.kindShape': 'форма',
    'editor.kindNode': 'узел',
    'editor.kindKey': 'ключ',
    'editor.kindStyle': 'стиль',
    'editor.kindBlock': 'блок',
    'editor.node': 'узел',
    'editor.snipPalette': 'палитра',
    'editor.snipPaletteHint': 'подключить словарь ролей',
    'editor.snipStep': 'шаг',
    'editor.snipStepHint': 'обычное действие системы',
    'editor.snipActor': 'актор',
    'editor.snipActorHint': 'кто действует',
    'editor.snipChoice': 'развилка',
    'editor.snipChoiceHint': 'условие с двумя исходами',
    'editor.snipStore': 'хранилище',
    'editor.snipStoreHint': 'таблица, кеш, файл',
    'editor.snipLink': 'связь',
    'editor.snipLinkHint': 'стрелка с подписью',
    'editor.snipGroup': 'контейнер',
    'editor.snipGroupHint': 'вложенный кусок сценария',
    'editor.snipNote': 'заметка',
    'editor.snipNoteHint': 'пояснение сбоку без рамки',
    'editor.snipTable': 'таблица',
    'editor.snipTableHint': 'схема данных',
    'editor.snipSeq': 'диалог',
    'editor.snipSeqHint': 'порядок сообщений во времени',
    'editor.snipDocLink': 'ссылка',
    'editor.snipDocLinkHint': 'переход в соседний документ',

    'graph.pageTitle': 'Карта проекта',
    'graph.title': 'Карта проекта',
    'graph.search': 'Поиск',
    'graph.searchPlaceholder': 'имя символа или файла',
    'graph.show': 'Показывать',
    'graph.map': 'Карта',
    'graph.sessions': 'Сессии',
    'graph.pickNode': 'Выбери узел на карте.',
    'graph.hint': 'колесо это зум, перетаскивание это панорама, клик по узлу это детали',
    'graph.nodes': 'узлов',
    'graph.edges': 'связей',
    'graph.files': 'файлов',
    'graph.removed': 'удалённых',
    'graph.clipped': 'не поместилось: {n}, сузьте поиском',
    'graph.noMatch': 'Под эти фильтры ничего не попало.',
    'graph.inbound': 'Входящие',
    'graph.outbound': 'Исходящие',
    'graph.identifier': 'Идентификатор',
    'graph.none': 'нет',
    'graph.noSessions': 'пока пусто',
    'graph.records': 'записей',
    'graph.kindModule': 'модули',
    'graph.kindClass': 'классы',
    'graph.kindFunction': 'функции',
    'graph.kindMethod': 'методы',
    'graph.kindInterface': 'интерфейсы',

    'setup.pageTitle': 'Настройка проекта',
    'setup.rootsTitle': 'Что попадает в карту',
    'setup.rootsWhy': 'Ничего не отмечено означает весь репозиторий. В монорепозитории это обычно не то, что нужно: карта вызовов тонет в чужих связях, и подсказки про пробелы начинают указывать на чужой код.',
    'setup.excludeTitle': 'Что пропускать дополнительно',
    'setup.excludeWhy': 'Сверх того, что уже пропущено по .gitignore. По шаблону на строку.',
    'setup.excludePlaceholder': '**/__generated__/**',
    'setup.placesTitle': 'Где что лежит',
    'setup.docsDir': 'Каталог документов',
    'setup.model': 'Модель для черновиков',
    'setup.studioTitle': 'Студия',
    'setup.studioWhy': 'Поднимается сама в начале сессии и гаснет, если её никто не смотрит. Ноль минут означает не гасить вовсе.',
    'setup.autoStart': 'Поднимать вместе с сессией',
    'setup.idle': 'Гасить после простоя, минут',
    'setup.save': 'Сохранить',
    'setup.saving': 'сохраняю...',
    'setup.saved': 'сохранено в aimd2.json, теперь нужен aimd2 scan',
    'setup.saveFailed': 'не сохранилось: {why}',
    'setup.loadFailed': 'не загрузилось: {why}',
  },

  en: {
    'app.name': 'Logic map',
    'app.tag': 'D2 STUDIO',

    'nav.library': 'Library',
    'nav.guide': 'Guide',
    'nav.codemap': 'Code map',
    'nav.lang': 'Language',

    'action.open': 'Open',
    'action.save': 'Save',
    'action.downloadSvg': 'Download SVG',
    'action.zoomIn': 'Zoom in',
    'action.zoomOut': 'Zoom out',
    'action.fit': 'Fit',
    'action.reload': 'Reload',
    'action.copy': 'Copy',
    'action.copied': 'Copied',

    'library.title': 'Logic library',
    'library.pageTitle': 'Logic library',
    'library.search': 'search',
    'library.searchPlaceholder': 'title, file, summary',
    'library.status': 'status',
    'library.area': 'area',
    'library.sync': 'checked against code',
    'library.total': 'documents',
    'library.colDoc': 'document',
    'library.colArea': 'area',
    'library.colStatus': 'status',
    'library.showing': 'showing {n} of {all}',
    'library.allStatuses': 'any status',
    'library.allAreas': 'any area',
    'library.allDocs': 'all documents',
    'library.onlyBroken': 'out of sync',
    'library.onlyClean': 'in sync',
    'library.diverged': 'out of sync: {n}',
    'library.drifted': 'code changed: {n}',
    'library.byHuman': 'checked by a person',
    'library.notConfirmed': 'only the agent read it',
    'library.emptyTitle': 'No logic documents yet.',
    'library.emptyWhere': 'They live in {dir} as {ext} files.',
    'library.emptyHow': 'Create the first one:',

    'doc.pageTitle': 'Logic document',
    'doc.tabCode': 'Code',
    'doc.tabProps': 'Properties',
    'doc.fieldTitle': 'Title',
    'doc.fieldArea': 'Area',
    'doc.fieldSummary': 'Summary',
    'doc.summaryPlaceholder': 'One or two sentences: this is what people read in the list',
    'doc.summaryHint': 'The file header keeps the summary on a single line, line breaks are joined on save.',
    'doc.anchors': 'anchors in code',
    'doc.noAnchors': 'not anchored to code',
    'doc.anchorOk': 'intact',
    'doc.anchorNoFile': 'file gone',
    'doc.anchorNoSymbol': 'symbol gone',
    'doc.anchorDrifted': 'code rewritten',
    'doc.flow': 'flow through the code',
    'doc.flowOk': 'hop is there',
    'doc.flowStepGone': 'step is not in the map',
    'doc.flowLinkGone': 'hop is not visible',
    'doc.linkBoard': 'Open board: {name}',
    'doc.linkDoc': 'Go to: {where}',
    'doc.linkGone': 'The link leads nowhere: {where}',
    'doc.sealHint': 'The fingerprint is stamped by aimd2 logic seal: it states that the document was checked against the code.',
    'doc.confirm': 'Checked',
    'doc.confirmHint': 'I read the code and the document, they agree right now',
    'doc.confirmed': 'checked',
    'doc.checkedHuman': 'A person checked this document.',
    'doc.checkedAgent': 'Only the agent checked this document, no person read it.',
    'doc.checkedNever': 'This document was never checked against the code.',
    'doc.legend': 'Legend',
    'doc.boardRoot': 'base',
    'doc.board.steps': 'step',
    'doc.board.scenarios': 'branch',
    'doc.board.layers': 'layer',
    'doc.boardPrev': 'Previous board',
    'doc.boardNext': 'Next board',
    'doc.stateTyping': 'typing',
    'doc.stateDrawing': 'drawing',
    'doc.stateUnsaved': 'unsaved',
    'doc.stateSaved': 'saved',
    'doc.stateErrors': 'errors: {n}',
    'doc.notFound': 'Cannot open the document: {path}',
    'doc.toLibrary': 'Back to library',

    'guide.pageTitle': 'D2 guide',
    'guide.title': 'D2 guide',
    'guide.lead': 'How to describe logic with a diagram: the language itself and the rules of this project, with live examples.',
    'guide.contents': 'sections',
    'guide.result': 'result',
    'guide.rendering': 'drawing',
    'guide.failed': 'the example did not compile',
    'guide.tryIt': 'Open in the editor',
    'guide.paletteRoles': 'Roles from the project palette',
    'guide.roleName': 'class',
    'guide.roleShape': 'shape',
    'guide.roleWhen': 'when to use',

    'editor.kindRole': 'role',
    'editor.kindShape': 'shape',
    'editor.kindNode': 'node',
    'editor.kindKey': 'key',
    'editor.kindStyle': 'style',
    'editor.kindBlock': 'block',
    'editor.node': 'node',
    'editor.snipPalette': 'palette',
    'editor.snipPaletteHint': 'pull in the role vocabulary',
    'editor.snipStep': 'step',
    'editor.snipStepHint': 'an ordinary action of the system',
    'editor.snipActor': 'actor',
    'editor.snipActorHint': 'who acts',
    'editor.snipChoice': 'choice',
    'editor.snipChoiceHint': 'a condition with two outcomes',
    'editor.snipStore': 'store',
    'editor.snipStoreHint': 'table, cache, file',
    'editor.snipLink': 'connection',
    'editor.snipLinkHint': 'an arrow with a label',
    'editor.snipGroup': 'container',
    'editor.snipGroupHint': 'a nested piece of the scenario',
    'editor.snipNote': 'note',
    'editor.snipNoteHint': 'an aside without a frame',
    'editor.snipTable': 'table',
    'editor.snipTableHint': 'a data schema',
    'editor.snipSeq': 'sequence',
    'editor.snipSeqHint': 'order of messages over time',
    'editor.snipDocLink': 'link',
    'editor.snipDocLinkHint': 'jump to a neighbouring document',

    'graph.pageTitle': 'Project map',
    'graph.title': 'Project map',
    'graph.search': 'Search',
    'graph.searchPlaceholder': 'symbol or file name',
    'graph.show': 'Show',
    'graph.map': 'Map',
    'graph.sessions': 'Sessions',
    'graph.pickNode': 'Pick a node on the map.',
    'graph.hint': 'wheel zooms, drag pans, click a node for details',
    'graph.nodes': 'nodes',
    'graph.edges': 'edges',
    'graph.files': 'files',
    'graph.removed': 'removed',
    'graph.clipped': 'not drawn: {n}, narrow with search',
    'graph.noMatch': 'Nothing matches these filters.',
    'graph.inbound': 'Incoming',
    'graph.outbound': 'Outgoing',
    'graph.identifier': 'Identifier',
    'graph.none': 'none',
    'graph.noSessions': 'nothing yet',
    'graph.records': 'records',
    'graph.kindModule': 'modules',
    'graph.kindClass': 'classes',
    'graph.kindFunction': 'functions',
    'graph.kindMethod': 'methods',
    'graph.kindInterface': 'interfaces',

    'setup.pageTitle': 'Project setup',
    'setup.rootsTitle': 'What goes into the map',
    'setup.rootsWhy': 'Nothing ticked means the whole repository. In a monorepo that is usually not what you want: the call map drowns in unrelated links, and the gap hints start pointing at code you do not work on.',
    'setup.excludeTitle': 'What else to skip',
    'setup.excludeWhy': 'On top of what .gitignore already skips. One pattern per line.',
    'setup.excludePlaceholder': '**/__generated__/**',
    'setup.placesTitle': 'Where things live',
    'setup.docsDir': 'Documents directory',
    'setup.model': 'Model for drafts',
    'setup.studioTitle': 'Studio',
    'setup.studioWhy': 'Starts itself at the beginning of a session and shuts down when nobody is looking. Zero minutes means never shut down.',
    'setup.autoStart': 'Start along with the session',
    'setup.idle': 'Shut down after idle, minutes',
    'setup.save': 'Save',
    'setup.saving': 'saving...',
    'setup.saved': 'saved to aimd2.json, now run aimd2 scan',
    'setup.saveFailed': 'not saved: {why}',
    'setup.loadFailed': 'not loaded: {why}',
  },
}

/** Словари наружу: по ним проверяется, что языки не разошлись ключами. */
export const DICTIONARIES = DICT

let lang = FALLBACK

export function currentLang() {
  return lang
}

/** Читает язык из хранилища. Вызывается один раз при загрузке страницы. */
export function initLang() {
  let stored = null
  try {
    stored = localStorage.getItem(KEY)
  } catch {
    // Приватный режим может запрещать хранилище, тогда остаётся язык по умолчанию.
  }
  lang = LANGS.some((l) => l.code === stored) ? stored : FALLBACK
  document.documentElement.setAttribute('lang', lang)
  return lang
}

/**
 * Меняет язык и перезагружает страницу. Студия многостраничная, и половина
 * подписей приходит из кода при отрисовке: перерисовать всё точечно вышло бы
 * длиннее и ненадёжнее, чем просто перечитать страницу.
 */
export function setLang(code) {
  if (!LANGS.some((l) => l.code === code) || code === lang) return
  try {
    localStorage.setItem(KEY, code)
  } catch {
    // Не сохранилось, перезагрузка вернёт прежний язык, и это честнее молчания.
  }
  location.reload()
}

/** Строка по ключу. Подстановки пишутся как {имя}. */
export function t(key, vars) {
  const table = DICT[lang] ?? DICT[FALLBACK]
  const raw = table[key] ?? DICT[FALLBACK][key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (whole, name) => (name in vars ? String(vars[name]) : whole))
}

/**
 * Подставляет тексты в готовую разметку. Элемент помечается атрибутом
 * data-i18n, а для полей и всплывающих подписей есть свои варианты.
 */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n)
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder)
  }
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle)
  const title = root.querySelector?.('title')
  if (title?.dataset.i18n) document.title = t(title.dataset.i18n)
}
