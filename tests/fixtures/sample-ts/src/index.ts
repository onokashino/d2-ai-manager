import { verifyToken } from './auth/token'

export function main(raw: string): string {
  return verifyToken(raw).id
}
