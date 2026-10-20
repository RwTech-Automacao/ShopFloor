import { describe, it, expect } from 'vitest'
import { almoxarifadoAutomaticoLigado, postoAlmoxarifadoDaOp, rotaComAlmoxarifadoNoFim, MSG_VARIOS_ALMOXARIFADOS } from '../almoxarifado-automatico'

const perfis = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, recurso]) => [k, { recurso }]))

describe('almoxarifadoAutomaticoLigado', () => {
  it('só liga com exatamente "1"', () => {
    expect(almoxarifadoAutomaticoLigado('1')).toBe(true)
    for (const v of [undefined, '', '0', 'true', 'sim', ' 1', '1 ']) expect(almoxarifadoAutomaticoLigado(v)).toBe(false)
  })
})

describe('postoAlmoxarifadoDaOp', () => {
  it('um único posto de perfil almoxarifado: devolve a chave (o nome não importa)', () => {
    expect(postoAlmoxarifadoDaOp(perfis({ Teste: 'nenhum', 'Estoque X': 'almoxarifado' }))).toEqual({ ok: true, posto: 'Estoque X' })
  })
  it('nenhum: posto null', () => {
    expect(postoAlmoxarifadoDaOp(perfis({ Teste: 'nenhum' }))).toEqual({ ok: true, posto: null })
    expect(postoAlmoxarifadoDaOp({})).toEqual({ ok: true, posto: null })
  })
  it('um posto chamado "Almoxarifado" SEM o perfil não conta', () => {
    expect(postoAlmoxarifadoDaOp(perfis({ Almoxarifado: 'nenhum' }))).toEqual({ ok: true, posto: null })
  })
  it('mais de um: erro VARIOS_ALMOXARIFADOS', () => {
    expect(postoAlmoxarifadoDaOp(perfis({ A: 'almoxarifado', B: 'almoxarifado' }))).toEqual({ ok: false, erro: 'VARIOS_ALMOXARIFADOS' })
    expect(MSG_VARIOS_ALMOXARIFADOS).toBe('Há mais de um posto com perfil Almoxarifado; mantenha só um.')
  })
})

describe('rotaComAlmoxarifadoNoFim', () => {
  it('acrescenta no fim', () => expect(rotaComAlmoxarifadoNoFim(['A', 'B'], 'Almox')).toEqual(['A', 'B', 'Almox']))
  it('rota vazia vira só o Almoxarifado', () => expect(rotaComAlmoxarifadoNoFim([], 'Almox')).toEqual(['Almox']))
  it('já presente: não duplica e não mexe na rota', () => {
    expect(rotaComAlmoxarifadoNoFim(['A', 'Almox'], 'Almox')).toEqual(['A', 'Almox'])
    expect(rotaComAlmoxarifadoNoFim(['Almox', 'A'], 'Almox')).toEqual(['Almox', 'A'])
  })
  it('sem posto Almoxarifado: rota intacta', () => expect(rotaComAlmoxarifadoNoFim(['A'], null)).toEqual(['A']))
})
