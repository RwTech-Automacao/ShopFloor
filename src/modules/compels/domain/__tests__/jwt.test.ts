import { describe, expect, it } from 'vitest'
import { expiracaoDoJwt } from '../jwt'

const jwtCom = (carga: object) => `x.${Buffer.from(JSON.stringify(carga)).toString('base64url')}.y`

describe('expiracaoDoJwt', () => {
  it('lê o exp em milissegundos', () => {
    expect(expiracaoDoJwt(jwtCom({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000)
  })

  it('devolve null quando não há exp, o token é torto ou vazio', () => {
    expect(expiracaoDoJwt(jwtCom({ sub: 'a' }))).toBeNull()
    expect(expiracaoDoJwt('isso-nao-e-jwt')).toBeNull()
    expect(expiracaoDoJwt('')).toBeNull()
    expect(expiracaoDoJwt('a.%%%.c')).toBeNull()
  })
})
