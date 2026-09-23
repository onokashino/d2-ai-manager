export const SCHEMA_VERSION = 3

/**
 * Версия правил разбора кода.
 *
 * Повышается, когда меняется то, что извлекается из исходников: новый язык,
 * новый вид символа, другой способ считать хеш тела. Схема базы при этом не
 * меняется, ронять её несовпадением незачем, а вот кеш файлов приходится
 * сбрасывать: содержимое файла прежнее, и по хешу скан счёл бы его
 * неизменившимся, оставив человека со старой, более бедной картой после
 * обновления инструмента.
 */
export const EXTRACTOR_VERSION = 2

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  agent      TEXT NOT NULL,
  model      TEXT,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
) STRICT;

CREATE TABLE IF NOT EXISTS nodes (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  layer           TEXT NOT NULL,
  title           TEXT NOT NULL,
  summary         TEXT,
  status          TEXT NOT NULL,
  source          TEXT NOT NULL,
  confidence      REAL NOT NULL,
  cluster_id      TEXT,
  -- Вид символа из парсера: class, function, method, interface. У модулей null.
  -- Без него просмотрщик не отличит класс от функции, а идентификатор узла,
  -- в который вид входит, нельзя разобрать обратно.
  symbol_kind     TEXT,
  -- Хеш тела символа. По нему документ логики понимает, что код под его
  -- якорем переписали: файл и символ на месте, а поведение уже другое.
  body_hash       TEXT,
  created_session TEXT NOT NULL,
  updated_session TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS anchors (
  node_id    TEXT NOT NULL,
  file       TEXT NOT NULL,
  symbol     TEXT NOT NULL DEFAULT '',
  start_line INTEGER NOT NULL,
  end_line   INTEGER NOT NULL,
  commit_sha TEXT,
  PRIMARY KEY (node_id, file, symbol)
) STRICT;

CREATE TABLE IF NOT EXISTS edges (
  from_id    TEXT NOT NULL,
  to_id      TEXT NOT NULL,
  kind       TEXT NOT NULL,
  source     TEXT NOT NULL,
  confidence REAL NOT NULL,
  PRIMARY KEY (from_id, to_id, kind)
) STRICT;

CREATE TABLE IF NOT EXISTS revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id    TEXT NOT NULL,
  session_id TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  change     TEXT NOT NULL,
  before     TEXT,
  after      TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS files (
  path       TEXT PRIMARY KEY,
  hash       TEXT NOT NULL,
  language   TEXT NOT NULL,
  size       INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS diagrams (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  view        TEXT NOT NULL,
  selector    TEXT NOT NULL,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  pinned      INTEGER NOT NULL DEFAULT 0
) STRICT;

CREATE INDEX IF NOT EXISTS idx_anchors_file     ON anchors (file);
CREATE INDEX IF NOT EXISTS idx_edges_from       ON edges (from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to         ON edges (to_id);
CREATE INDEX IF NOT EXISTS idx_revisions_node   ON revisions (node_id);
CREATE INDEX IF NOT EXISTS idx_revisions_sess   ON revisions (session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_layer      ON nodes (layer);
`
