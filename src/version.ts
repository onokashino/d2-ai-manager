import { createRequire } from 'node:module'

// Версия читается из package.json, а не дублируется строкой рядом: зашитая
// копия расходится с опубликованной при первом же выпуске, и aimd2 --version
// начинает врать. И src, и dist лежат на один уровень ниже корня пакета,
// поэтому путь одинаков и в сборке, и в тестах.
const read = createRequire(import.meta.url)

export const PACKAGE_VERSION: string = (read('../package.json') as { version: string }).version
