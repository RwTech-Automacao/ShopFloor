import { describe, expect, it } from 'vitest'
import { cadeiaDaOp, incluirPrt, prtsForaDaOp, trechosDaOpGravada, trechosParaGravar } from '../edicao-op-trechos'
import type { OpEspelho } from '../cadastro-op'

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: `${codigo} desc`, situacao: 'Em Processo', nivel, quantidade: 10,
  quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'C01', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
// cadeia no Compels: PRT410 (nível 3) → PRT420 (nível 2) → PMOC14; a OP foi cadastrada sem a PRT420
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const GRAVADA = trechosDaOpGravada(
  [
    { seq: 1, codigo: 'PRT410', tipo: 'prt', compels_op: '8500', sn_modo: 'proprio' },
    { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498', sn_modo: 'mesmo' },
  ],
  [{ posto: 'SPI', ordem: 0, trecho_seq: 1 }, { posto: 'Inspeção PTH', ordem: 1, trecho_seq: 2 }, { posto: 'Almoxarifado', ordem: 2, trecho_seq: 2 }],
  [{ seq: 1, sn_ini: '1001', sn_fim: '1010', trecho_seq: 2 }, { seq: 2, sn_ini: 'P001', sn_fim: 'P010', trecho_seq: 1 }],
  ESPELHO,
)
const CADEIA = cadeiaDaOp(GRAVADA, ESPELHO)

describe('incluir de novo uma PRT que ficou fora da OP', () => {
  it('a cadeia vem da OP da PMO no espelho; sem ela (ou cadastro manual), vazia', () => {
    expect(CADEIA.map((t) => t.codigo)).toEqual(['PRT410', 'PRT420', 'PMOC14'])
    expect(cadeiaDaOp(GRAVADA, [])).toEqual([])
    expect(cadeiaDaOp(GRAVADA.map((t) => ({ ...t, compelsOp: null })), ESPELHO)).toEqual([])
  })
  it('fora da OP: só as PRTs da cadeia que não são trecho', () => {
    expect(prtsForaDaOp(GRAVADA, CADEIA).map((t) => t.codigo)).toEqual(['PRT420'])
    expect(prtsForaDaOp(GRAVADA, [])).toEqual([])
  })
  it('entra no lugar dela na cadeia, sem posto, marcada como incluída', () => {
    const prt420 = prtsForaDaOp(GRAVADA, CADEIA)[0]!
    const r = incluirPrt(GRAVADA, CADEIA, prt420)
    expect(r.map((t) => [t.codigo, t.postos, t.incluida ?? false])).toEqual([
      ['PRT410', ['SPI'], false], ['PRT420', [], true], ['PMOC14', ['Inspeção PTH', 'Almoxarifado'], false],
    ])
    expect(r[1]).toMatchObject({ seq: -2, compelsOp: '8499', snModo: 'mesmo', faixas: [] })
    expect(prtsForaDaOp(r, CADEIA)).toEqual([])
    // já incluída, ou fora da cadeia: nada muda
    expect(incluirPrt(r, CADEIA, prt420)).toBe(r)
    expect(incluirPrt(GRAVADA, CADEIA, { ...prt420, compelsOp: '9999' })).toBe(GRAVADA)
  })
  it('para gravar: a incluída vai sem seq, com código e OP do Compels, na ordem da tela', () => {
    const r = incluirPrt(GRAVADA, CADEIA, prtsForaDaOp(GRAVADA, CADEIA)[0]!)
    const comPosto = r.map((t) => (t.incluida ? { ...t, postos: ['Inspeção PTH'] } : t.tipo === 'pmo' ? { ...t, postos: ['Almoxarifado'] } : t))
    expect(trechosParaGravar(comPosto)).toEqual([
      { seq: 1, postos: ['SPI'], sn_modo: 'proprio', faixas: [{ sn_ini: 'P001', sn_fim: 'P010' }] },
      { seq: null, codigo: 'PRT420', compels_op: '8499', postos: ['Inspeção PTH'], sn_modo: 'mesmo', faixas: [] },
      { seq: 2, postos: ['Almoxarifado'], sn_modo: 'mesmo', faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ])
  })
})
