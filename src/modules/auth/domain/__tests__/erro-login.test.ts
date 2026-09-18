import { describe, it, expect } from 'vitest'
import { mensagemErroLogin, MSG_CREDENCIAL_INVALIDA, MSG_MUITAS_TENTATIVAS, MSG_SISTEMA_FORA } from '../erro-login'

describe('mensagemErroLogin', () => {
  it('senha errada continua "Usuário ou senha inválidos"', () => {
    expect(mensagemErroLogin({ status: 400, code: 'invalid_credentials', name: 'AuthApiError' })).toBe(MSG_CREDENCIAL_INVALIDA)
  })

  it('banco desligado (GoTrue 500) avisa que o sistema está fora do ar', () => {
    expect(mensagemErroLogin({ status: 500, code: 'unexpected_failure', name: 'AuthApiError' })).toBe(MSG_SISTEMA_FORA)
  })

  it('gateway sem o GoTrue (502/503/504) também é sistema fora do ar', () => {
    for (const status of [502, 503, 504]) {
      expect(mensagemErroLogin({ status, name: 'AuthRetryableFetchError' })).toBe(MSG_SISTEMA_FORA)
    }
  })

  it('sem resposta nenhuma (status 0) é sistema fora do ar', () => {
    expect(mensagemErroLogin({ status: 0, name: 'AuthRetryableFetchError' })).toBe(MSG_SISTEMA_FORA)
    expect(mensagemErroLogin({ name: 'AuthRetryableFetchError' })).toBe(MSG_SISTEMA_FORA)
  })

  it('limite de tentativas tem mensagem própria', () => {
    expect(mensagemErroLogin({ status: 429, code: 'over_request_rate_limit' })).toBe(MSG_MUITAS_TENTATIVAS)
  })

  it('a mensagem de fora do ar diz o horário de funcionamento', () => {
    expect(MSG_SISTEMA_FORA).toContain('segunda a sábado, das 06:00 às 19:00')
  })
})
