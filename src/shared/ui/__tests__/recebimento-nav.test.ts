import { describe, it, expect } from 'vitest'
import { RECEBIMENTO_NAV } from '../recebimento-nav'

describe('RECEBIMENTO_NAV', () => {
  it('contém as abas do Recebimento esperadas', () => {
    const chaves = RECEBIMENTO_NAV.map((i) => i.chave)
    expect(chaves).toEqual(['importar', 'processos', 'importacoes', 'etiquetas'])
  })
  it('todas as rotas ficam sob /recebimento', () => {
    expect(RECEBIMENTO_NAV.every((i) => i.href.startsWith('/recebimento/'))).toBe(true)
  })
})
