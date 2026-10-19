import { describe, it, expect } from 'vitest'
import { destinatariosSemCanal, type DestinatarioDisponivel } from '../regra'

const ANA: DestinatarioDisponivel = {
  usuarioId: 'u1', nome: 'Ana', email: 'ana@x', telegram: true, discord: true, emailOk: true,
}
const BETO: DestinatarioDisponivel = {
  usuarioId: 'u2', nome: 'Beto', email: '', telegram: false, discord: false, emailOk: false,
}
// Tem endereço preenchido, mas ele não serve (ex.: o banco disse que não): o "tem canal" é emailOk,
// nunca a presença do texto do endereço.
const CIDA: DestinatarioDisponivel = {
  usuarioId: 'u3', nome: 'Cida', email: 'cida@x', telegram: true, discord: true, emailOk: false,
}

describe('destinatariosSemCanal com e-mail', () => {
  it('avisa quem está sem endereço de e-mail quando a regra manda e-mail', () => {
    expect(destinatariosSemCanal([ANA, BETO], ['u1', 'u2'], ['email'])).toEqual(['Beto sem E-mail'])
  })

  it('não avisa ninguém do e-mail quando o canal de e-mail não está marcado', () => {
    expect(destinatariosSemCanal([ANA, BETO], ['u1', 'u2'], ['telegram'])).toEqual(['Beto sem Telegram'])
  })

  it('soma os avisos dos três canais', () => {
    expect(destinatariosSemCanal([BETO], ['u2'], ['telegram', 'discord', 'email'])).toEqual([
      'Beto sem Telegram',
      'Beto sem Discord',
      'Beto sem E-mail',
    ])
  })

  it('o e-mail vale pelo emailOk, não pelo texto do endereço', () => {
    expect(destinatariosSemCanal([CIDA], ['u3'], ['email'])).toEqual(['Cida sem E-mail'])
  })
})
