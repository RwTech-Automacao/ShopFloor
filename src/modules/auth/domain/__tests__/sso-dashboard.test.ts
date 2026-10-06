import { describe, expect, it } from 'vitest'
import { validarClaimsDashboard, validarNextEmbed } from '../sso-dashboard'

const ACEITO = 'dashboard@enterplak.com.br'

describe('validarClaimsDashboard', () => {
  it('aceita os claims da conta compartilhada', () => {
    const r = validarClaimsDashboard({ email: ACEITO, jti: 'abc-123' }, ACEITO)
    expect(r).toEqual({ ok: true, claims: { email: ACEITO, jti: 'abc-123' } })
  })

  it('normaliza o e-mail antes de comparar', () => {
    const r = validarClaimsDashboard({ email: '  DASHBOARD@Enterplak.com.BR ', jti: 'j1' }, ACEITO)
    expect(r.ok && r.claims.email).toBe(ACEITO)
  })

  it('RECUSA qualquer outro e-mail, mesmo válido', () => {
    const r = validarClaimsDashboard({ email: 'gestor@enterplak.com.br', jti: 'j1' }, ACEITO)
    expect(r).toEqual({
      ok: false,
      erro: 'Este emissor só pode entrar com a conta do dashboard.',
    })
  })

  it('recusa sem e-mail', () => {
    expect(validarClaimsDashboard({ jti: 'j1' }, ACEITO).ok).toBe(false)
  })

  it('recusa sem jti: sem ele não há anti-replay', () => {
    expect(validarClaimsDashboard({ email: ACEITO }, ACEITO)).toEqual({
      ok: false,
      erro: 'Token sem identificador (jti).',
    })
    expect(validarClaimsDashboard({ email: ACEITO, jti: '   ' }, ACEITO).ok).toBe(false)
  })

  it('recusa quando o e-mail aceito não está configurado', () => {
    expect(validarClaimsDashboard({ email: ACEITO, jti: 'j1' }, '').ok).toBe(false)
  })
})

describe('validarNextEmbed', () => {
  it('aceita caminho dentro de /embed/', () => {
    expect(validarNextEmbed('/embed/fluxo/PMOC13/2340%2F26')).toEqual({
      ok: true, next: '/embed/fluxo/PMOC13/2340%2F26',
    })
  })

  it('recusa URL absoluta', () => {
    expect(validarNextEmbed('https://evil.com/embed/x')).toEqual({
      ok: false, erro: 'Destino inválido.',
    })
  })

  it('recusa barra dupla (host relativo a esquema)', () => {
    expect(validarNextEmbed('//evil.com/embed/x').ok).toBe(false)
    expect(validarNextEmbed('/\\evil.com').ok).toBe(false)
  })

  it('recusa caminho fora de /embed/', () => {
    expect(validarNextEmbed('/home').ok).toBe(false)
    expect(validarNextEmbed('/shopfloor/fluxo').ok).toBe(false)
    expect(validarNextEmbed('/embedx/fluxo').ok).toBe(false)
  })

  it('recusa travessia de diretório, inclusive codificada', () => {
    for (const ruim of ['/embed/../home', '/embed/..%2Fhome', '/embed/%2e%2e/home', '/embed/a/../../home']) {
      expect(validarNextEmbed(ruim).ok).toBe(false)
    }
  })

  it('recusa ausente, vazio e o que não é string', () => {
    for (const ruim of [null, undefined, '', '   ', 42, {}]) {
      expect(validarNextEmbed(ruim).ok).toBe(false)
    }
  })

  it('recusa caractere de controle e nova linha (resposta partida)', () => {
    expect(validarNextEmbed('/embed/fluxo\r\nSet-Cookie: x=1').ok).toBe(false)
    expect(validarNextEmbed('/embed/fluxo\n').ok).toBe(false)
  })

  it('aceita exatamente /embed/ com algo depois, não /embed sozinho', () => {
    expect(validarNextEmbed('/embed').ok).toBe(false)
    expect(validarNextEmbed('/embed/').ok).toBe(true)
  })

  it('recusa entrada que não decodifica, sem estourar', () => {
    expect(validarNextEmbed('/embed/%E0%A4%A').ok).toBe(false)
  })

  it('recusa nova linha e barra invertida percent-encoded', () => {
    expect(validarNextEmbed('/embed/x%0d%0aSet-Cookie:y').ok).toBe(false)
    expect(validarNextEmbed('/embed/..%5Chome').ok).toBe(false)
  })
})
