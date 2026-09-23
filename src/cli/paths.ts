import { join } from 'node:path'

export function defaultDbPath(root: string): string {
  return join(root, '.aimd2', 'graph.sqlite')
}
