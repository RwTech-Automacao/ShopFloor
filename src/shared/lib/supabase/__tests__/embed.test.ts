import { describe, expect, it } from 'vitest'
import {
  CABECALHO_EMBED,
  COOKIE_EMBED,
  cabecalhosComMarcaEmbed,
  ehCaminhoEmbed,
  opcoesCookieEmbed,
} from '../embed'

describe('ehCaminhoEmbed', () => {
  it('reconhece /embed e o que está abaixo', () => {
    for (const p of ['/embed', '/embed/', '/embed/sso', '/embed/fluxo/PMOC13/2340%2F26']) {
      expect(ehCaminhoEmbed(p)).toBe(true)
    }
  })
  it('NÃO confunde com caminho que só começa parecido', () => {
    for (const p of ['/embedx', '/embedded/fluxo', '/home', '/', '/shopfloor/fluxo', '/api/embed']) {
      expect(ehCaminhoEmbed(p)).toBe(false)
    }
  })
})

describe('opcoesCookieEmbed', () => {
  it('no embed devolve o cookie próprio, com Path=/embed', () => {
    expect(opcoesCookieEmbed(true)).toEqual({ name: COOKIE_EMBED, path: '/embed' })
  })
  it('fora do embed não devolve nada: vale o cookie padrão', () => {
    expect(opcoesCookieEmbed(false)).toBeUndefined()
  })
})

describe('cabecalhosComMarcaEmbed', () => {
  it('injeta a marca em /embed/*', () => {
    const saida = cabecalhosComMarcaEmbed(new Headers({ cookie: 'a=1' }), '/embed/fluxo/PMOC13/2340')
    expect(saida.get(CABECALHO_EMBED)).toBe('1')
    expect(saida.get('cookie')).toBe('a=1')
  })

  // A marca diz ONDE a requisição está, não é um pedido do cliente: em rota normal ela é apagada
  // mesmo que tenha chegado na mão. Sem isso, quem tiver o cookie da conta compartilhada navega
  // o app inteiro como ela.
  it('APAGA a marca mandada pelo cliente em caminho que não é embed', () => {
    for (const p of ['/home', '/embedx', '/shopfloor/fluxo', '/api/alertas/telegram', '/']) {
      const saida = cabecalhosComMarcaEmbed(new Headers({ [CABECALHO_EMBED]: '1' }), p)
      expect(saida.get(CABECALHO_EMBED), p).toBeNull()
    }
  })

  it('não altera os cabeçalhos originais (devolve cópia)', () => {
    const entrada = new Headers({ [CABECALHO_EMBED]: '1' })
    cabecalhosComMarcaEmbed(entrada, '/home')
    expect(entrada.get(CABECALHO_EMBED)).toBe('1')
  })
})
