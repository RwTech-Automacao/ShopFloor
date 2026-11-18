import { describe, it, expect } from 'vitest'
import {
  MODULOS_ALERTA,
  NOME_MODULO_ALERTA,
  ROTA_ALERTAS,
  TIPOS_REGRA_OCULTOS_NA_CRIACAO,
  TIPOS_REGRA_POR_MODULO,
  ehModuloAlerta,
  tipoPertenceAoModulo,
  tiposOferecidosNaCriacao,
} from '../modulo'
import { TIPOS_REGRA } from '../tipos'

describe('módulo da regra de alerta', () => {
  it('reconhece só os três módulos que têm alertas', () => {
    expect(ehModuloAlerta('shopfloor')).toBe(true)
    expect(ehModuloAlerta('recebimento')).toBe(true)
    expect(ehModuloAlerta('sat')).toBe(true)
    expect(ehModuloAlerta('faturamento')).toBe(false)
    expect(ehModuloAlerta('setup')).toBe(false)
    expect(ehModuloAlerta('sistema')).toBe(false)
    expect(ehModuloAlerta(undefined)).toBe(false)
  })

  it('tem nome e rota para cada módulo', () => {
    expect(MODULOS_ALERTA).toEqual(['shopfloor', 'recebimento', 'sat'])
    for (const m of MODULOS_ALERTA) expect(NOME_MODULO_ALERTA[m]).not.toBe('')
    expect(ROTA_ALERTAS.shopfloor).toBe('/configuracoes/sf-alertas')
    expect(ROTA_ALERTAS.recebimento).toBe('/configuracoes/rec-alertas')
    // O SAT não tem Configurações próprias: a tela mora no acordeão do SAT.
    expect(ROTA_ALERTAS.sat).toBe('/sat/alertas')
    expect(NOME_MODULO_ALERTA.sat).toBe('SAT')
    // As rotas são DIFERENTES: é o que faz o RBAC do menu funcionar por módulo.
    expect(new Set(Object.values(ROTA_ALERTAS)).size).toBe(MODULOS_ALERTA.length)
  })

  it('cada tipo de regra pertence a exatamente um módulo', () => {
    const vistos = MODULOS_ALERTA.flatMap((m) => [...TIPOS_REGRA_POR_MODULO[m]])
    expect([...vistos].sort()).toEqual([...TIPOS_REGRA].sort())
    expect(new Set(vistos).size).toBe(vistos.length)
  })

  it('os tipos de posto (e os do Almoxarifado: parado, compels e ficha) são do ShopFloor', () => {
    expect(TIPOS_REGRA_POR_MODULO.shopfloor).toEqual([
      'aprovacao', 'tempo', 'defeito', 'resumo', 'parado', 'compels', 'ficha',
    ])
  })

  it('o fim de EMB é do Recebimento, e só dele', () => {
    expect(TIPOS_REGRA_POR_MODULO.recebimento).toEqual(['emb'])
    expect(tipoPertenceAoModulo('emb', 'shopfloor')).toBe(false)
    expect(tipoPertenceAoModulo('emb', 'recebimento')).toBe(true)
  })

  it('a entrada no SAT é do SAT, e só dele', () => {
    expect(TIPOS_REGRA_POR_MODULO.sat).toEqual(['sat_entrada'])
    expect(tipoPertenceAoModulo('sat_entrada', 'sat')).toBe(true)
    expect(tipoPertenceAoModulo('sat_entrada', 'shopfloor')).toBe(false)
    expect(tipoPertenceAoModulo('sat_entrada', 'recebimento')).toBe(false)
    expect(tipoPertenceAoModulo('emb', 'sat')).toBe(false)
    expect(tiposOferecidosNaCriacao('sat')).toEqual(['sat_entrada'])
  })

  it('tipoPertenceAoModulo recusa o tipo do outro módulo', () => {
    expect(tipoPertenceAoModulo('aprovacao', 'shopfloor')).toBe(true)
    expect(tipoPertenceAoModulo('aprovacao', 'recebimento')).toBe(false)
  })

  it('a ficha de apontamento está oculta na regra nova, mas continua sendo do ShopFloor', () => {
    expect(TIPOS_REGRA_OCULTOS_NA_CRIACAO).toEqual(['ficha'])
    expect(tiposOferecidosNaCriacao('shopfloor')).toEqual([
      'aprovacao', 'tempo', 'defeito', 'resumo', 'parado', 'compels',
    ])
    expect(tiposOferecidosNaCriacao('recebimento')).toEqual(['emb'])
    // A regra de ficha que já existe continua válida no servidor (editar, desativar, excluir).
    expect(tipoPertenceAoModulo('ficha', 'shopfloor')).toBe(true)
  })

  it('esvaziar a lista de ocultos volta a oferecer todos os tipos do módulo', () => {
    expect(tiposOferecidosNaCriacao('shopfloor', [])).toEqual(TIPOS_REGRA_POR_MODULO.shopfloor)
  })
})
