import { describe, it, expect } from 'vitest'
import { CONFIG_NAV } from '../config-nav'

describe('CONFIG_NAV', () => {
  it('contém as abas de configuração esperadas', () => {
    const chaves = CONFIG_NAV.map((i) => i.chave)
    expect(chaves).toEqual(['usuarios', 'perfis', 'listas', 'campos', 'logs', 'sobre'])
  })
  it('todas as rotas ficam sob /configuracoes', () => {
    expect(CONFIG_NAV.every((i) => i.href.startsWith('/configuracoes/'))).toBe(true)
  })
})
