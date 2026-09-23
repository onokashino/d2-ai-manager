/* Содержимое справочника по D2. Лежит отдельно от страницы: текста много, и
   он переводится, а разметка и логика страницы одна на все языки.

   Виды блоков:
     text     абзац
     list     список
     code     код без картинки, когда рисовать нечего
     example  код и живая картинка рядом
     roles    таблица ролей, собирается из палитры проекта
     warn     предупреждение о грабле */

const RU = [
  {
    id: 'start',
    title: 'С чего начать',
    blocks: [
      { t: 'text', text: 'Документ логики это текстовый файл .d2. Вы пишете, из чего состоит поведение, а раскладку по полотну считает программа. Двигать мышью ничего не нужно, и поэтому документ нормально живёт в репозитории и читается в код-ревью.' },
      { t: 'text', text: 'Самый маленький документ это два узла и стрелка между ними. Слева от двоеточия имя, по которому на узел ссылаются, справа подпись, которую видит человек.' },
      {
        t: 'example',
        code: `...@_palette

request: Пришла заявка { class: step }
check: Проверить подпись { class: choice }
done: Принято { class: done }

request -> check
check -> done: подпись верна`,
      },
      { t: 'text', text: 'Первая строка подключает палитру проекта: общий словарь форм и цветов. Без неё диаграмма тоже соберётся, но всё будет одинаковым серым прямоугольником.' },
    ],
  },
  {
    id: 'nodes',
    title: 'Узлы и подписи',
    blocks: [
      { t: 'text', text: 'Имя узла это ключ, подпись это значение. Имя должно быть коротким и без пробелов: по нему вы будете писать связи. Подпись пишется для человека, в ней можно всё.' },
      { t: 'code', code: `db: База заявок
q: Очередь на отправку
err: Отказ, подпись не сошлась` },
      { t: 'text', text: 'Если подпись не нужна, хватит одного имени. Тогда именем и подпишется.' },
      { t: 'code', code: `Клиент\nСервер` },
      { t: 'warn', text: 'Имя без подписи удобно для черновика, но в готовом документе подпись почти всегда нужна: имена короткие, а читателю нужен смысл.' },
    ],
  },
  {
    id: 'links',
    title: 'Связи',
    blocks: [
      { t: 'text', text: 'Стрелка пишется двумя именами и знаком между ними. Подпись у связи ставится после двоеточия и отвечает на вопрос, при каком условии переход происходит.' },
      {
        t: 'example',
        code: `...@_palette

check: Подпись верна? { class: choice }
ok: Принять { class: done }
no: Отказать { class: danger }

check -> ok: да
check -> no: нет { class: error }`,
      },
      { t: 'list', items: [
        'a -> b   обычное направление',
        'a <- b   в обратную сторону',
        'a <-> b  в обе стороны',
        'a -- b   связь без направления',
      ] },
      { t: 'text', text: 'Классы связей из палитры меняют вид линии: async для отложенного, error для ветки отказа, data для потока данных, weak для второстепенного.' },
    ],
  },
  {
    id: 'roles',
    title: 'Роли: палитра проекта',
    blocks: [
      { t: 'text', text: 'Форма и цвет в этом проекте не выбираются на глаз. Роль задаётся классом, и одинаковые вещи выглядят одинаково во всех документах. Класс пишется в фигурных скобках после подписи.' },
      { t: 'code', code: `user: Пользователь { class: actor }` },
      { t: 'roles' },
      { t: 'warn', text: 'Не пишите цвет руками. Если подходящей роли нет, скажите об этом, а не изобретайте свой оттенок: палитра для того и общая.' },
    ],
  },
  {
    id: 'containers',
    title: 'Контейнеры',
    blocks: [
      { t: 'text', text: 'Когда узлов становится больше десятка, их пора группировать. Контейнер это узел с фигурными скобками, внутри которых живут свои узлы и свои связи.' },
      {
        t: 'example',
        code: `...@_palette

api: Приём заявки {
  validate: Проверка { class: step }
  store: Запись { class: store }
  validate -> store
}

client: Клиент { class: actor }
client -> api.validate: отправляет`,
      },
      { t: 'text', text: 'Снаружи к внутреннему узлу обращаются через точку: api.validate. Вложенность читается гораздо лучше, чем двадцать узлов в ряд.' },
    ],
  },
  {
    id: 'shapes',
    title: 'Формы',
    blocks: [
      { t: 'text', text: 'Роли из палитры уже несут форму, и обычно её хватает. Но форму можно задать и напрямую, когда нужна редкая.' },
      {
        t: 'example',
        code: `a: Решение { shape: diamond }
b: Хранилище { shape: cylinder }
c: Облако { shape: cloud }
d: Документ { shape: document }
e: Очередь { shape: queue }`,
      },
      { t: 'text', text: 'Доступны rectangle, square, page, parallelogram, document, cylinder, queue, package, step, callout, stored_data, person, diamond, oval, circle, hexagon, cloud, text, code, class, sql_table, sequence_diagram.' },
    ],
  },
  {
    id: 'text',
    title: 'Текстовые блоки',
    blocks: [
      { t: 'text', text: 'Правило иногда проще написать словами, чем нарисовать. Для этого есть блок с разметкой: он открывается вертикальной чертой и закрывается такой же.' },
      {
        t: 'example',
        code: `...@_palette

rule: |md
  **Одна точка отката**

  Узел, его якоря и ревизия пишутся тремя
  операциями. Без общей точки отката сбой на
  любой из них оставил бы узел без истории.
| { class: note }`,
      },
      { t: 'text', text: 'Класс note убирает рамку: это пояснение, а не шаг сценария. Но держите такой блок коротким: длинный текст участвует в раскладке наравне с шагами, растягивает её, и схема открывается в таком масштабе, где не прочесть ничего.' },
    ],
  },
  {
    id: 'tips',
    title: 'Объяснение к узлу',
    blocks: [
      { t: 'text', text: 'Всё, что длиннее строки, вешается на сам узел подсказкой. На раскладку она не влияет совсем, D2 ставит на такой узел значок, а студия показывает текст блоком рядом при наведении.' },
      {
        t: 'example',
        code: `...@_palette

settled: Хватает? {
  class: choice
  tooltip: "Покрытие считается перемножением, а не делением: при нулевом допуске недобор в одну единицу давал бы ровно ноль пунктов и прошёл бы как точная оплата."
}
yes: SETTLED { class: done }
no: Ждём дальше { class: step }

settled -> yes: да
settled -> no: нет`,
      },
      { t: 'text', text: 'Вопрос на ромбе держите в два-три слова. Длинный вопрос раздувает ромб и растаскивает всю схему вширь. Подробности идут в подсказку.' },
      { t: 'text', text: 'И ещё одно про расстановку: раскладчик ведёт основную линию по первой объявленной связи узла. У развилки пишите сначала продолжение, а потом тупик, и тогда цепочка условий встанет прямым столбцом, а исходы отойдут от неё вбок.' },
    ],
  },
  {
    id: 'data',
    title: 'Схема данных',
    blocks: [
      { t: 'text', text: 'Когда речь о таблицах, рисуйте таблицы. Форма sql_table показывает поля и связи по внешним ключам.' },
      {
        t: 'example',
        code: `orders: {
  shape: sql_table
  id: int { constraint: primary_key }
  user_id: int { constraint: foreign_key }
  status: text
}

users: {
  shape: sql_table
  id: int { constraint: primary_key }
  email: text
}

orders.user_id -> users.id`,
      },
    ],
  },
  {
    id: 'sequence',
    title: 'Диалог во времени',
    blocks: [
      { t: 'text', text: 'Если важен порядок сообщений, а не структура, берите sequence_diagram. Время идёт сверху вниз.' },
      {
        t: 'example',
        code: `dialog: {
  shape: sequence_diagram

  client: Клиент
  api: Служба
  db: База

  client -> api: запрос
  api -> db: чтение
  db -> api: строки
  api -> client: ответ
}`,
      },
    ],
  },
  {
    id: 'steps',
    title: 'Ход по шагам',
    blocks: [
      { t: 'text', text: 'Одна картинка показывает устройство, но не показывает ход. Когда важно, что происходит по порядку, документ делится на доски: общая основа и шаги, каждый из которых добавляет к предыдущему. В студии они переключаются полосой над полотном.' },
      {
        t: 'example',
        code: `...@_palette

direction: right

client: Клиент { class: actor }
api: Служба { class: step }
db: Заявки { class: store }

client -> api: подаёт заявку

steps: {
  проверка: {
    api -> db: нет ли дубликата
  }
  запись: {
    api -> db: сохраняет
    db.style.stroke: "#3ecf8e"
  }
  ответ: {
    api -> client: номер заявки
  }
}`,
      },
      { t: 'text', text: 'Шаг не повторяет схему заново: он дописывает к тому, что уже нарисовано. Поэтому в шаге пишут только то, что этот шаг добавляет или меняет.' },
      { t: 'text', text: 'Рядом с шагами есть ещё два вида досок. Ветка через scenarios показывает, что будет, если пойти иначе: она начинается от той же основы, но не продолжает предыдущую. Слой через layers это отдельная схема, связанная с этой по смыслу, например разбор одного узла подробнее.' },
      {
        t: 'code',
        code: `scenarios: {
  отказ: {
    api -> client: дубликат, отказ { class: error }
  }
}

layers: {
  очередь: {
    worker: Обработчик { class: step }
    q: Очередь { class: queue }
    q -> worker: забирает
  }
}`,
      },
      { t: 'warn', text: 'Шаги стоит заводить там, где порядок действительно важен: согласование, откат, повтор после ошибки. Для схемы, которую читают целиком, они лишние и только прячут половину за переключателем.' },
    ],
  },
  {
    id: 'crosslinks',
    title: 'Ссылки и подсказки',
    blocks: [
      { t: 'text', text: 'Документ ссылается на соседний через link. В студии такая ссылка открывает другой документ, а в стороннем инструменте остаётся обычной ссылкой.' },
      { t: 'code', code: `statuses: Статусы заявки {
  class: artifact
  link: /d/docs/logic/order-status.d2
}` },
      { t: 'text', text: 'Подсказка при наведении пишется в tooltip. В неё хорошо убирать подробность, которая на схеме мешала бы.' },
      { t: 'code', code: `retry: Повтор { tooltip: три попытки с паузой в минуту }` },
      { t: 'text', text: 'Ссылайтесь, когда описываете то, что подробно разобрано в другом документе, вместо того чтобы пересказывать его заново.' },
    ],
  },
  {
    id: 'layout',
    title: 'Раскладка',
    blocks: [
      { t: 'text', text: 'Направление задаётся одной строкой: down, right, up, left. Сценарий обычно читается сверху вниз, а поток данных слева направо.' },
      { t: 'code', code: `direction: right` },
      { t: 'text', text: 'Раскладку считает движок, их два. Dagre выстраивает слоями и хорош для сценариев. Elk аккуратнее ведёт связи и лучше держит большие схемы. Переключатель есть в верхней панели документа.' },
      { t: 'warn', text: 'Не боритесь с раскладкой вручную. Если схема выглядит запутанной, почти всегда дело в том, что в одном документе смешаны две темы: разделите их и поставьте ссылку.' },
    ],
  },
  {
    id: 'header',
    title: 'Шапка документа',
    blocks: [
      { t: 'text', text: 'Первые строки файла это комментарии, и они обязательны. По ним документ показывается в библиотеке и сверяется с кодом.' },
      { t: 'code', code: `# title: Статусы заявки
# status: review
# area: Orders
# summary: Тринадцать кодов жизненного цикла, кто их двигает и какие терминальны.
# updated: 2026-09-22
# anchors: src/order/status.ts:OrderStatus, src/order/queue.ts` },
      { t: 'list', items: [
        'status: draft, review, approved или outdated. approved ставит только человек.',
        'summary: одно-два предложения, по ним документ узнают в списке.',
        'anchors: путь к файлу и, необязательно, символ через двоеточие.',
      ] },
      { t: 'text', text: 'Якорь отвечает на вопрос, правда ли ещё документ. Если файл исчез или символ пропал, документ помечается разошедшимся, и это видно в библиотеке.' },
    ],
  },
  {
    id: 'mistakes',
    title: 'Частые ошибки',
    blocks: [
      { t: 'list', items: [
        'Пересказ кода построчно. Документ объясняет правила и причины, реализацию человек прочитает в коде.',
        'Один огромный документ обо всём. Одна тема это один документ, связи между темами делаются ссылками.',
        'Цвет руками вместо роли. Одинаковые вещи должны выглядеть одинаково.',
        'Название по имени функции. «Как проверяется подпись» это название документа, «Функция verifyToken» нет.',
        'Быстро протухающие подробности: числа из базы, временные обходные пути, имена веток.',
        'Абзацы текста прямо на полотне. Длинный блок растягивает раскладку, и схему становится не прочесть: объяснение вешается на узел подсказкой.',
        'Длинный вопрос на ромбе. Ромб раздувается шире, чем расстояние между ветками, и они перестают расходиться в стороны.',
      ] },
    ],
  },
]

const EN = [
  {
    id: 'start',
    title: 'Getting started',
    blocks: [
      { t: 'text', text: 'A logic document is a plain .d2 file. You describe what the behaviour is made of, and the layout is computed for you. Nothing is dragged with a mouse, which is why the document lives happily in the repository and reads well in code review.' },
      { t: 'text', text: 'The smallest document is two nodes and an arrow. Left of the colon is the name you refer to the node by, right of it is the label a person reads.' },
      {
        t: 'example',
        code: `...@_palette

request: Request arrives { class: step }
check: Verify signature { class: choice }
done: Accepted { class: done }

request -> check
check -> done: signature is valid`,
      },
      { t: 'text', text: 'The first line pulls in the project palette: the shared vocabulary of shapes and colours. Without it the diagram still compiles, but everything becomes the same grey rectangle.' },
    ],
  },
  {
    id: 'nodes',
    title: 'Nodes and labels',
    blocks: [
      { t: 'text', text: 'The node name is a key, the label is its value. Keep the name short and without spaces: you will write connections with it. The label is for people, anything goes there.' },
      { t: 'code', code: `db: Request store
q: Outbound queue
err: Rejected, signature did not match` },
      { t: 'text', text: 'If no label is needed, the name alone is enough and doubles as the label.' },
      { t: 'code', code: `Client\nServer` },
      { t: 'warn', text: 'A bare name is fine in a draft, but a finished document almost always wants a label: names are short, and the reader needs meaning.' },
    ],
  },
  {
    id: 'links',
    title: 'Connections',
    blocks: [
      { t: 'text', text: 'An arrow is two names with a sign between them. A label after the colon answers the question of under which condition the transition happens.' },
      {
        t: 'example',
        code: `...@_palette

check: Signature valid? { class: choice }
ok: Accept { class: done }
no: Reject { class: danger }

check -> ok: yes
check -> no: no { class: error }`,
      },
      { t: 'list', items: [
        'a -> b   the usual direction',
        'a <- b   the other way round',
        'a <-> b  both ways',
        'a -- b   a link with no direction',
      ] },
      { t: 'text', text: 'Connection classes from the palette change how the line looks: async for deferred work, error for the failure branch, data for a flow of data, weak for something secondary.' },
    ],
  },
  {
    id: 'roles',
    title: 'Roles: the project palette',
    blocks: [
      { t: 'text', text: 'Shape and colour are not picked by eye here. The role is set by a class, so the same kind of thing looks the same in every document. The class goes in braces after the label.' },
      { t: 'code', code: `user: User { class: actor }` },
      { t: 'roles' },
      { t: 'warn', text: 'Never write a colour by hand. If no role fits, say so instead of inventing a shade: the whole point of the palette is that it is shared.' },
    ],
  },
  {
    id: 'containers',
    title: 'Containers',
    blocks: [
      { t: 'text', text: 'Past a dozen nodes it is time to group them. A container is a node with braces, holding its own nodes and its own connections.' },
      {
        t: 'example',
        code: `...@_palette

api: Intake {
  validate: Validation { class: step }
  store: Write { class: store }
  validate -> store
}

client: Client { class: actor }
client -> api.validate: submits`,
      },
      { t: 'text', text: 'From the outside you reach an inner node through a dot: api.validate. Nesting reads far better than twenty nodes in a row.' },
    ],
  },
  {
    id: 'shapes',
    title: 'Shapes',
    blocks: [
      { t: 'text', text: 'Palette roles already carry a shape and that is usually enough. Still, a shape can be set directly when you need a rare one.' },
      {
        t: 'example',
        code: `a: Decision { shape: diamond }
b: Storage { shape: cylinder }
c: Cloud { shape: cloud }
d: Document { shape: document }
e: Queue { shape: queue }`,
      },
      { t: 'text', text: 'Available: rectangle, square, page, parallelogram, document, cylinder, queue, package, step, callout, stored_data, person, diamond, oval, circle, hexagon, cloud, text, code, class, sql_table, sequence_diagram.' },
    ],
  },
  {
    id: 'text',
    title: 'Text blocks',
    blocks: [
      { t: 'text', text: 'A rule is sometimes easier written out than drawn. That is what a markdown block is for: it opens with a vertical bar and closes with one.' },
      {
        t: 'example',
        code: `...@_palette

rule: |md
  **One rollback point**

  A node, its anchors and its revision are three
  writes. Without a shared rollback point a failure
  in any of them would leave a node with no history.
| { class: note }`,
      },
      { t: 'text', text: 'The note class drops the frame: this is an aside, not a step of the scenario. Keep such a block short: a long text takes part in the layout alongside the steps, stretches it, and the diagram opens at a zoom where nothing can be read.' },
    ],
  },
  {
    id: 'tips',
    title: 'An explanation on a node',
    blocks: [
      { t: 'text', text: 'Anything longer than a line goes onto the node itself as a tooltip. It does not affect the layout at all, D2 marks such a node with a badge, and the studio shows the text in a block beside it on hover.' },
      {
        t: 'example',
        code: `...@_palette

settled: Enough? {
  class: choice
  tooltip: "Coverage is checked by multiplication rather than division: with a zero tolerance a shortfall of one atomic unit would come out as exactly zero points and pass as an exact payment."
}
yes: SETTLED { class: done }
no: Keep waiting { class: step }

settled -> yes: yes
settled -> no: no`,
      },
      { t: 'text', text: 'Keep the question on a diamond down to two or three words. A long question blows the diamond up and stretches the whole diagram sideways. Details belong in the tooltip.' },
      { t: 'text', text: 'One more thing about placement: the layout engine follows the first declared connection of a node. At a branch, write the continuation first and the dead end second, and the chain of conditions lines up as a straight column with the outcomes hanging off to the side.' },
    ],
  },
  {
    id: 'data',
    title: 'Data schema',
    blocks: [
      { t: 'text', text: 'When the subject is tables, draw tables. The sql_table shape shows fields and foreign key links.' },
      {
        t: 'example',
        code: `orders: {
  shape: sql_table
  id: int { constraint: primary_key }
  user_id: int { constraint: foreign_key }
  status: text
}

users: {
  shape: sql_table
  id: int { constraint: primary_key }
  email: text
}

orders.user_id -> users.id`,
      },
    ],
  },
  {
    id: 'sequence',
    title: 'A dialogue over time',
    blocks: [
      { t: 'text', text: 'When the order of messages matters more than the structure, use sequence_diagram. Time runs from top to bottom.' },
      {
        t: 'example',
        code: `dialog: {
  shape: sequence_diagram

  client: Client
  api: Service
  db: Database

  client -> api: request
  api -> db: read
  db -> api: rows
  api -> client: response
}`,
      },
    ],
  },
  {
    id: 'steps',
    title: 'Walking through a sequence',
    blocks: [
      { t: 'text', text: 'One picture shows how something is put together, but not how it unfolds. When the order matters, a document splits into boards: a shared base and steps, each adding to the one before. The studio switches between them with the strip above the canvas.' },
      {
        t: 'example',
        code: `...@_palette

direction: right

client: Client { class: actor }
api: Service { class: step }
db: Requests { class: store }

client -> api: submits a request

steps: {
  check: {
    api -> db: any duplicate?
  }
  write: {
    api -> db: stores it
    db.style.stroke: "#3ecf8e"
  }
  answer: {
    api -> client: request number
  }
}`,
      },
      { t: 'text', text: 'A step does not redraw the diagram: it adds to what is already there. So a step contains only what that step adds or changes.' },
      { t: 'text', text: 'There are two more kinds of board. A branch through scenarios shows what happens if things go the other way: it starts from the same base and does not continue the previous step. A layer through layers is a separate diagram related to this one, for example one node taken apart in detail.' },
      {
        t: 'code',
        code: `scenarios: {
  rejected: {
    api -> client: duplicate, rejected { class: error }
  }
}

layers: {
  queue: {
    worker: Worker { class: step }
    q: Queue { class: queue }
    q -> worker: picks up
  }
}`,
      },
      { t: 'warn', text: 'Steps earn their place where the order really matters: approval, rollback, retry after a failure. For a diagram meant to be read at a glance they are noise, and they hide half of it behind a switch.' },
    ],
  },
  {
    id: 'crosslinks',
    title: 'Links and tooltips',
    blocks: [
      { t: 'text', text: 'A document points at a neighbour through link. In the studio such a link opens the other document, and in any other tool it stays an ordinary link.' },
      { t: 'code', code: `statuses: Request statuses {
  class: artifact
  link: /d/docs/logic/order-status.d2
}` },
      { t: 'text', text: 'A hover hint goes into tooltip. It is a good place for the detail that would clutter the diagram.' },
      { t: 'code', code: `retry: Retry { tooltip: three attempts, a minute apart }` },
      { t: 'text', text: 'Link out when you are describing something another document already covers, instead of retelling it.' },
    ],
  },
  {
    id: 'layout',
    title: 'Layout',
    blocks: [
      { t: 'text', text: 'Direction is a single line: down, right, up, left. A scenario usually reads top to bottom, a flow of data left to right.' },
      { t: 'code', code: `direction: right` },
      { t: 'text', text: 'The layout is computed by an engine, and there are two. Dagre stacks things in layers and suits scenarios. Elk routes connections more carefully and holds larger diagrams better. The switch is in the document toolbar.' },
      { t: 'warn', text: 'Do not fight the layout by hand. When a diagram looks tangled it almost always means two topics ended up in one document: split them and add a link.' },
    ],
  },
  {
    id: 'header',
    title: 'The document header',
    blocks: [
      { t: 'text', text: 'The first lines of the file are comments, and they are required. They are what the library shows and what the code check reads.' },
      { t: 'code', code: `# title: Request statuses
# status: review
# area: Orders
# summary: Thirteen lifecycle codes, who moves them and which ones are terminal.
# updated: 2026-09-22
# anchors: src/order/status.ts:OrderStatus, src/order/queue.ts` },
      { t: 'list', items: [
        'status: draft, review, approved or outdated. Only a person sets approved.',
        'summary: one or two sentences, this is what people read in the list.',
        'anchors: a file path and, optionally, a symbol after a colon.',
      ] },
      { t: 'text', text: 'An anchor answers whether the document is still true. If the file is gone or the symbol disappeared, the document is marked out of sync and the library shows it.' },
    ],
  },
  {
    id: 'mistakes',
    title: 'Common mistakes',
    blocks: [
      { t: 'list', items: [
        'Retelling the code line by line. A document explains rules and reasons, the implementation is read in the code.',
        'One huge document about everything. One topic is one document, topics are joined by links.',
        'A hand-picked colour instead of a role. The same kind of thing should look the same.',
        'Naming a document after a function. "How a signature is verified" is a title, "The verifyToken function" is not.',
        'Details that rot fast: numbers from a database, temporary workarounds, branch names.',
      ] },
    ],
  },
]

export function guideSections(lang) {
  return lang === 'en' ? EN : RU
}
