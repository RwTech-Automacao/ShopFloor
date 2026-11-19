import { describe, it, expect } from 'vitest'
import { resolverPlaca, type FaixaOp } from '../integracao-matching'

const F = (pmo: string, op: string, ini: string, fim: string): FaixaOp => ({ pmo, op, sn_ini: ini, sn_fim: fim })
const FAIXAS = [
  F('PMOB76', '8801', 'B7600', 'B7699'),
  F('PMO974', '8811', '97400', '97499'),
  F('PMOX99', '9000', 'X9900', 'X9999'), // fora da receita
]
const RECEITA = ['pmob76', 'pmo974'] // receita guarda lower/trim (como no domínio receita)

describe('resolverPlaca', () => {
  it('encaixa SN na OP/PMO certa (dentro da faixa + na receita)', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'B7601')).toEqual({ ok: true, pmo: 'PMOB76', op: '8801' })
    expect(resolverPlaca(RECEITA, FAIXAS, '97450')).toEqual({ ok: true, pmo: 'PMO974', op: '8811' })
  })
  it('SN de PMO fora da receita → FORA_RECEITA', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'X9950')).toEqual({ ok: false, erro: 'FORA_RECEITA' })
  })
  it('SN que não cai em nenhuma faixa → SEM_OP', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'Z0001')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('duas OPs da receita contendo o SN → AMBIGUO com os candidatos', () => {
    const dupl = [F('PMOB76', '8801', 'B7600', 'B7699'), F('PMOB76', '8802', 'B7600', 'B7699')]
    expect(resolverPlaca(['pmob76'], dupl, 'B7601')).toEqual({
      ok: false,
      erro: 'AMBIGUO',
      candidatos: [
        { pmo: 'PMOB76', op: '8801' },
        { pmo: 'PMOB76', op: '8802' },
      ],
    })
  })
})

describe('resolverPlaca com várias faixas (0181)', () => {
  it('SN na segunda faixa da OP da placa encaixa nela', () => {
    const multi: FaixaOp = { ...F('PMOB76', '8801', 'B7600', 'B7699'), faixas: [{ sn_ini: 'B7600', sn_fim: 'B7699' }, { sn_ini: 'C100', sn_fim: 'C110' }] }
    expect(resolverPlaca(RECEITA, [multi, FAIXAS[1]!], 'C105')).toEqual({ ok: true, pmo: 'PMOB76', op: '8801' })
    expect(resolverPlaca(RECEITA, [multi, FAIXAS[1]!], 'C111')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
})

describe('resolverPlaca com PRT da própria OP na receita (0195)', () => {
  // a OP do produto PMOE/9100 tem as faixas da PMO e as da PRT410 (série própria): todas aparecem nela
  const OP_PRODUTO: FaixaOp = { ...F('PMOE', '9100', '100', '199'), faixas: [{ sn_ini: '100', sn_fim: '199' }, { sn_ini: 'A001', sn_fim: 'A050' }] }
  const OUTRA_PRT: FaixaOp = F('PRT410', '8683', 'A001', 'A050') // OP separada com o código da PRT e faixa igual
  const DA_OP = { op: '9100', prts: [{ codigo: 'PRT410', faixas: [{ sn_ini: 'A001', sn_fim: 'A050' }] }] }

  it('encaixa a placa no item da PRT com a OP do produto (o código como está na receita)', () => {
    expect(resolverPlaca(['prt410'], [OP_PRODUTO, ...FAIXAS], 'A010', DA_OP)).toEqual({ ok: true, pmo: 'PRT410', op: '9100' })
  })
  it('a OP separada com o código da PRT continua valendo pela regra da PMO (as duas regras valem)', () => {
    const separada = F('PRT410', '8683', 'Z001', 'Z050')
    expect(resolverPlaca(['PRT410'], [separada, OP_PRODUTO], 'Z010', DA_OP)).toEqual({ ok: true, pmo: 'PRT410', op: '8683' })
    expect(resolverPlaca(['PRT410'], [OUTRA_PRT, OP_PRODUTO], 'A010', DA_OP)).toEqual({
      ok: false, erro: 'AMBIGUO', candidatos: [{ pmo: 'PRT410', op: '9100' }, { pmo: 'PRT410', op: '8683' }],
    })
  })
  it('outra OP que só tem a mesma PRT como trecho (pmo dela é outro) não encaixa', () => {
    const outraOp: FaixaOp = { ...F('PMOF', '9200', '200', '299'), faixas: [{ sn_ini: '200', sn_fim: '299' }, { sn_ini: 'F001', sn_fim: 'F050' }] }
    expect(resolverPlaca(['PRT410'], [OP_PRODUTO, outraOp], 'F010', DA_OP)).toEqual({ ok: false, erro: 'FORA_RECEITA' })
  })
  it('receita só com a PRT: SN de outra PMO fica fora (não libera qualquer PMO)', () => {
    expect(resolverPlaca(['PRT410'], [OP_PRODUTO, ...FAIXAS], 'B7601', DA_OP)).toEqual({ ok: false, erro: 'FORA_RECEITA' })
    expect(resolverPlaca(['PRT410'], [OP_PRODUTO, ...FAIXAS], 'Z0001', DA_OP)).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('receita mista: cada SN pela sua regra; os dois juntos dão AMBIGUO', () => {
    const receita = ['PMOB76', 'PRT410']
    expect(resolverPlaca(receita, [OP_PRODUTO, ...FAIXAS], 'B7601', DA_OP)).toEqual({ ok: true, pmo: 'PMOB76', op: '8801' })
    expect(resolverPlaca(receita, [OP_PRODUTO, ...FAIXAS], 'A001', DA_OP)).toEqual({ ok: true, pmo: 'PRT410', op: '9100' })
    const colide = F('PMOB76', '8803', 'A001', 'A050')
    expect(resolverPlaca(receita, [OP_PRODUTO, colide], 'A001', DA_OP)).toEqual({
      ok: false, erro: 'AMBIGUO', candidatos: [{ pmo: 'PRT410', op: '9100' }, { pmo: 'PMOB76', op: '8803' }],
    })
  })
  it('sem PRT da OP na receita: o resultado de antes', () => {
    expect(resolverPlaca(RECEITA, FAIXAS, 'B7601', DA_OP)).toEqual(resolverPlaca(RECEITA, FAIXAS, 'B7601'))
    expect(resolverPlaca([], [OUTRA_PRT], 'A001', DA_OP)).toEqual({ ok: true, pmo: 'PRT410', op: '8683' })
    expect(resolverPlaca(['PRT410'], [OUTRA_PRT], 'A001', { op: '9100', prts: [] })).toEqual({ ok: true, pmo: 'PRT410', op: '8683' })
  })
})
