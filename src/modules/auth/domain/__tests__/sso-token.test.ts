import { describe, it, expect } from 'vitest'
import { validarClaimsSso, RegistroJti } from '../sso-token'

describe('validarClaimsSso', () => {
  const base = { email: 'Ana.Silva@RwTech.com.br', jti: 'uuid-1', sub: 'p-1', name: 'Ana Silva' }

  it('normaliza o e-mail — a busca do usuário não pode depender de como o portal digitou', () => {
    const r = validarClaimsSso({ ...base, email: '  Ana.Silva@RwTech.com.br ' })
    expect(r).toMatchObject({ ok: true, claims: { email: 'ana.silva@rwtech.com.br' } })
  })

  it('recusa token sem e-mail — é a chave pra achar o usuário aqui', () => {
    expect(validarClaimsSso({ ...base, email: '' })).toEqual({ ok: false, erro: 'Token sem e-mail.' })
  })

  it('recusa e-mail malformado em vez de sair procurando no banco', () => {
    expect(validarClaimsSso({ ...base, email: 'ana.silva' }))
      .toEqual({ ok: false, erro: 'Token com e-mail inválido.' })
  })

  it('recusa token sem jti — sem ele o anti-replay não existe', () => {
    expect(validarClaimsSso({ ...base, jti: '' }))
      .toEqual({ ok: false, erro: 'Token sem identificador (jti).' })
  })

  it('aceita sub e name ausentes — são informativos, não bloqueiam a entrada', () => {
    const r = validarClaimsSso({ email: 'ana@rwtech.com.br', jti: 'uuid-1' })
    expect(r).toMatchObject({ ok: true, claims: { sub: '', name: '' } })
  })
})

describe('RegistroJti', () => {
  it('aceita o primeiro uso e recusa o mesmo token de novo', () => {
    const r = new RegistroJti()
    expect(r.registrar('uuid-1', 1_000, 0)).toBe(true)
    expect(r.registrar('uuid-1', 1_000, 0)).toBe(false)
  })

  it('tokens diferentes não se atrapalham', () => {
    const r = new RegistroJti()
    expect(r.registrar('uuid-1', 1_000, 0)).toBe(true)
    expect(r.registrar('uuid-2', 1_000, 0)).toBe(true)
  })

  it('esquece o que já expirou — o mapa não pode crescer pra sempre', () => {
    const r = new RegistroJti()
    r.registrar('uuid-1', 1_000, 0)
    expect(r.tamanho).toBe(1)
    r.registrar('uuid-2', 5_000, 2_000) // a limpeza roda no registro seguinte
    expect(r.tamanho).toBe(1)
  })

  it('depois de expirado o mesmo jti volta a ser aceito — mas o exp do token já o barra antes', () => {
    const r = new RegistroJti()
    r.registrar('uuid-1', 1_000, 0)
    expect(r.registrar('uuid-1', 9_000, 2_000)).toBe(true)
  })
})
