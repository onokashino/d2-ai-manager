export type Layer = 'structure' | 'behavior' | 'plan' | 'data'

export type NodeKind = 'module' | 'symbol' | 'behavior' | 'plan' | 'data'

export type NodeStatus = 'planned' | 'in_progress' | 'implemented' | 'drifted' | 'removed'

export type NodeSource = 'parser' | 'model' | 'human'

export type EdgeKind =
  | 'imports'
  | 'calls'
  | 'implements'
  | 'precedes'
  | 'reads'
  | 'writes'
  | 'plans'
  | 'supersedes'

export interface Anchor {
  /** Путь относительно корня проекта, только прямые слэши. */
  file: string
  /** Путь символа в дереве разбора, например "AuthService/verifyToken". Пустая строка для модуля. */
  symbol: string
  startLine: number
  endLine: number
  commit: string | null
}

export interface GraphNode {
  id: string
  kind: NodeKind
  layer: Layer
  title: string
  summary: string | null
  status: NodeStatus
  source: NodeSource
  confidence: number
  clusterId: string | null
  /** Вид символа из парсера: class, function, method, interface. У модулей null. */
  symbolKind: string | null
  /**
   * Хеш тела символа, с которым документы логики сверяют свои якоря. Считается
   * от текста без разницы в пробелах, поэтому переформатирование его не
   * двигает, а любая правка по существу двигает.
   */
  bodyHash: string | null
  anchors: Anchor[]
}

export interface GraphEdge {
  from: string
  to: string
  kind: EdgeKind
  source: NodeSource
  confidence: number
}
