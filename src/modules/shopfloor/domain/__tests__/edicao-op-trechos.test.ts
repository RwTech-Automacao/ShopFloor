import { describe, expect, it } from 'vitest'
import { faixasDaPmo, postosGravados, postosParaAdicionar, rotaDosTrechos, trechosDaOpGravada, trechosParaGravar } from '../edicao-op-trechos'
import type { OpEspelho } from '../cadastro-op'

const TRECHOS = [
  { seq: 3, codigo: 'PMOC14', tipo: 'pmo' as const, compels_op: '8498', sn_modo: 'mesmo' as const },
  { seq: 1, codigo: 'PRT410', tipo: 'prt' as const, compels_op: '8500', sn_modo: 'proprio' as const },
  { seq: 2, codigo: 'PRT420', tipo: 'prt' as const, compels_op: '8499', sn_modo: 'mesmo' as const },
]
const POSTOS = [
  { posto: 'Almoxarifado', ordem: 4, trecho_seq: 3 },
  { posto: 'SPI', ordem: 0, trecho_seq: 1 },
  { posto: 'Inspeção PTH', ordem: 1, trecho_seq: 2 },
  { posto: 'Teste', ordem: 2, trecho_seq: null },
  { posto: 'Embalagem', ordem: 3, trecho_seq: 3 },
]
const FAIXAS = [
  { seq: 1, sn_ini: '1001', sn_fim: '1010', trecho_seq: 3 },
  { seq: 2, sn_ini: 'P001', sn_fim: 'P010', trecho_seq: 1 },
]
const ESPELHO = [{ numero: 8500, quantidade: 10, situacao: 'Em Processo', descricao: 'PARTES' }] as OpEspelho[]

describe('edição de OP com trechos', () => {
  const trechos = trechosDaOpGravada(TRECHOS, POSTOS, FAIXAS, ESPELHO)

  it('monta os trechos na ordem, com os postos de cada um (sem trecho = PMO), as faixas e o espelho', () => {
    expect(trechos.map((t) => [t.codigo, t.postos])).toEqual([
      ['PRT410', ['SPI']], ['PRT420', ['Inspeção PTH']], ['PMOC14', ['Teste', 'Embalagem', 'Almoxarifado']],
    ])
    expect(trechos[0]).toMatchObject({ snModo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P010' }], quantidade: 10, situacao: 'Em Processo' })
    expect(trechos[1]).toMatchObject({ snModo: 'mesmo', faixas: [], quantidade: null, situacao: '' })
    expect(trechos[2]!.faixas).toEqual([{ sn_ini: '1001', sn_fim: '1010' }])
    expect(rotaDosTrechos(trechos)).toEqual(['SPI', 'Inspeção PTH', 'Teste', 'Embalagem', 'Almoxarifado'])
    expect(faixasDaPmo(trechos)).toEqual([{ sn_ini: '1001', sn_fim: '1010' }])
  })

  it('PMO sem faixa gravada abre com uma faixa vazia', () => {
    expect(trechosDaOpGravada(TRECHOS, POSTOS, [])[2]!.faixas).toEqual([{ sn_ini: '', sn_fim: '' }])
  })

  it('adicionar: qualquer posto fora da rota, em qualquer trecho; o Almoxarifado nunca numa PRT', () => {
    const semSpi = trechos.map((t) => (t.seq === 1 ? { ...t, postos: [] } : t))
    const semAlmox = semSpi.map((t) => (t.tipo === 'pmo' ? { ...t, postos: ['Teste', 'Embalagem'] } : t))
    const catalogo = ['SPI', 'Inspeção PTH', 'Teste', 'Embalagem', 'Almoxarifado', 'Burn-in']
    expect(postosParaAdicionar(catalogo, semAlmox, semAlmox[1]!, 'Almoxarifado')).toEqual(['SPI', 'Burn-in'])
    expect(postosParaAdicionar(catalogo, semAlmox, semAlmox[2]!, 'Almoxarifado')).toEqual(['SPI', 'Almoxarifado', 'Burn-in'])
    expect(postosGravados(trechos).has('Teste')).toBe(true)
  })

  it('para gravar: PMO sempre "mesmo" com as faixas; PRT "mesmo" sem faixa', () => {
    const editados = trechos.map((t) => (t.seq === 2 ? { ...t, faixas: [{ sn_ini: 'X', sn_fim: 'Y' }] } : t))
    expect(trechosParaGravar(editados)).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P010' }] },
      { seq: 2, postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 3, postos: ['Teste', 'Embalagem', 'Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
  })
})
