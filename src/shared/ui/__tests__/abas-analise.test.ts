import { describe, expect, it } from 'vitest'
import { ABAS_ANALISE } from '../kiosk/abas'

describe('abas da Análise', () => {
  it('"Peças paradas" vem logo depois de "Estoque pendente" e abre /shopfloor/analisar/parados', () => {
    const rotulos = ABAS_ANALISE.map((a) => a.rotulo)
    const i = rotulos.indexOf('Estoque pendente')
    expect(ABAS_ANALISE[i + 1]).toEqual({ rotulo: 'Peças paradas', href: '/shopfloor/analisar/parados' })
  })
})
