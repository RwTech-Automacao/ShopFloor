import { describe, it, expect } from 'vitest'
import {
  MODULOS_ALERTA,
  NOME_MODULO_ALERTA,
  ROTA_ALERTAS,
  TIPOS_REGRA_POR_MODULO,
  ehModuloAlerta,
  tipoPertenceAoModulo,
} from '../modulo'
import { TIPOS_REGRA } from '../tipos'

describe('módulo da regra de alerta', () => {
  it('reconhece só os dois módulos que têm alertas', () => {
    expect(ehModuloAlerta('shopfloor')).toBe(true)
    expect(ehModuloAlerta('recebimento')).toBe(true)
    expect(ehModuloAlerta('setup')).toBe(false)
    expect(ehModuloAlerta('sistema')).toBe(false)
    expect(ehModuloAlerta(undefined)).toBe(false)
  })

  it('tem nome e rota para cada módulo', () => {
    for (const m of MODULOS_ALERTA) {
      expect(NOME_MODULO_ALERTA[m]).not.toBe('')
      expect(ROTA_ALERTAS[m].startsWith('/configuracoes/')).toBe(true)
    }
    // As duas rotas são DIFERENTES: é o que faz o RBAC do menu funcionar por módulo.
    expect(ROTA_ALERTAS.shopfloor).not.toBe(ROTA_ALERTAS.recebimento)
  })

  it('cada tipo de regra pertence a exatamente um módulo', () => {
    const vistos = MODULOS_ALERTA.flatMap((m) => [...TIPOS_REGRA_POR_MODULO[m]])
    expect([...vistos].sort()).toEqual([...TIPOS_REGRA].sort())
    expect(new Set(vistos).size).toBe(vistos.length)
  })

  it('os tipos de posto (e o parado do Almoxarifado) são do ShopFloor', () => {
    expect(TIPOS_REGRA_POR_MODULO.shopfloor).toEqual([
      'aprovacao', 'tempo', 'defeito', 'resumo', 'parado',
    ])
  })

  it('o fim de EMB é do Recebimento, e só dele', () => {
    expect(TIPOS_REGRA_POR_MODULO.recebimento).toEqual(['emb'])
    expect(tipoPertenceAoModulo('emb', 'shopfloor')).toBe(false)
    expect(tipoPertenceAoModulo('emb', 'recebimento')).toBe(true)
  })

  it('tipoPertenceAoModulo recusa o tipo do outro módulo', () => {
    expect(tipoPertenceAoModulo('aprovacao', 'shopfloor')).toBe(true)
    expect(tipoPertenceAoModulo('aprovacao', 'recebimento')).toBe(false)
  })
})
