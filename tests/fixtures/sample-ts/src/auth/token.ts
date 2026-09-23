import { touchSession } from './session'

export interface User {
  id: string
}

export class TokenService {
  verify(raw: string): User {
    touchSession(raw)
    return { id: raw }
  }
}

export function verifyToken(raw: string): User {
  return new TokenService().verify(raw)
}
