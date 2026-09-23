import type { DatabaseSync } from 'node:sqlite'
import { listDocuments, DEFAULT_DOCS_DIR } from './library.js'

export interface Gap {
  file: string
  /** Сколько модулей проекта его импортируют. */
  usedBy: number
  /** Сколько функций, классов и прочих символов в нём разобрано. */
  symbols: number
}

interface Row {
  file: string
  used_by: number
  symbols: number
}

/**
 * Файлы, на которые не смотрит ни один документ логики, отсортированные по
 * тому, насколько на них опирается остальной проект.
 *
 * Это подсказка, а не требование. Документ нужен там, где поведение нельзя
 * понять из одного файла, и большинство файлов документа не заслуживают.
 * Порядок выбран так, чтобы наверху оказалось то, от чего зависит многое:
 * если такой файл никем не описан, это чаще всего настоящий пробел.
 */
export async function findGaps(
  db: DatabaseSync,
  root: string,
  limit = 10,
  docsDir = DEFAULT_DOCS_DIR,
): Promise<Gap[]> {
  const docs = await listDocuments(root, docsDir)
  const covered = new Set(docs.flatMap((d) => d.anchors.map((a) => a.file)))

  const rows = db
    .prepare(
      `SELECT
         a.file AS file,
         (SELECT count(*) FROM edges e WHERE e.to_id = n.id) AS used_by,
         (SELECT count(*) FROM anchors s
            JOIN nodes sn ON sn.id = s.node_id
            WHERE s.file = a.file AND s.symbol <> '' AND sn.status <> 'removed') AS symbols
       FROM nodes n
       JOIN anchors a ON a.node_id = n.id
       WHERE n.kind = 'module' AND n.status <> 'removed'
       ORDER BY used_by DESC, symbols DESC`,
    )
    .all() as unknown as Row[]

  return rows
    .filter((r) => !covered.has(r.file))
    // Файл, который никто не импортирует и в котором нет ни одного символа,
    // это данные или заглушка, а не поведение.
    .filter((r) => r.used_by > 0 || r.symbols > 0)
    .slice(0, limit)
    .map((r) => ({ file: r.file, usedBy: r.used_by, symbols: r.symbols }))
}
