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
