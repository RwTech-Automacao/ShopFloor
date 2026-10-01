import { describe, it, expect, afterEach, vi } from 'vitest'
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
  // Um teste aqui adianta o relógio; sem isto o próximo teste herdaria o relógio falso.
  afterEach(() => { vi.useRealTimers() })

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
    r.registrar('uuid-2', 65_000, 61_001) // a limpeza roda no registro seguinte, já passada a folga
    expect(r.tamanho).toBe(1)
  })

  it('depois de expirado o mesmo jti volta a ser aceito — mas o exp do token já o barra antes', () => {
    const r = new RegistroJti()
    r.registrar('uuid-1', 1_000, 0)
    expect(r.registrar('uuid-1', 70_000, 61_001)).toBe(true)
  })

  it('um token 10 s depois do exp não é aceito duas vezes — a tolerância de relógio deixava essa janela descoberta', () => {
    const r = new RegistroJti()
    const exp = 60_000
    expect(r.registrar('uuid-1', exp, 50_000)).toBe(true)
    // Passado o `exp`, o jwtVerify AINDA aceita o token (clockTolerance). Se o registro já tiver
    // esquecido o jti nessa janela, o mesmo link entra de novo.
    expect(r.registrar('uuid-1', exp, exp + 10_000)).toBe(false)
  })

  it('lembra do jti na janela de tolerância usando o relógio real — é o caminho que a rota /sso usa', () => {
    const r = new RegistroJti()
    const t0 = new Date('2026-10-01T12:00:00Z').getTime()
    const exp = t0 + 60_000
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    expect(r.registrar('uuid-1', exp)).toBe(true)
    vi.setSystemTime(exp + 10_000)
    expect(r.registrar('uuid-1', exp)).toBe(false)
  })

  it('a folga não é eterna: passada a retenção o jti sai do mapa', () => {
    const r = new RegistroJti(60_000)
    const exp = 60_000
    r.registrar('uuid-1', exp, 50_000)
    r.registrar('uuid-2', exp, exp + 60_000 + 1) // a limpeza roda no registro seguinte
    expect(r.tamanho).toBe(1)
  })
})

