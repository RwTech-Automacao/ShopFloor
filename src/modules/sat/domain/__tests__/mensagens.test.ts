import { describe, expect, it } from 'vitest'
import { mensagemEntrada, mensagemMudancaNf } from '../mensagens'

describe('mensagemEntrada', () => {
  it('aprovada', () => {
    expect(mensagemEntrada({ ns: '00043005620019177', cliente: 'Cliente A', os: '90001', nf: '4521', situacao: 'aprovada', motivos: [] }))
      .toBe('📦 Chegou no SAT: 00043005620019177 (Cliente A, OS 90001) — NF 4521 aprovada ✅')
  })
  it('reprovada com os motivos', () => {
    expect(mensagemEntrada({ ns: '562-19177', cliente: 'Cliente A', os: '', nf: '4521', situacao: 'reprovada', motivos: ['Sem CFOP', 'Valor divergente'] }))
      .toBe('📦 Chegou no SAT: 562-19177 (Cliente A) — NF 4521 reprovada ❌ (Sem CFOP; Valor divergente)')
  })
  it('sem cliente nem OS', () => {
    expect(mensagemEntrada({ ns: 'X', cliente: '', os: '', nf: '1', situacao: 'aprovada', motivos: [] }))
      .toBe('📦 Chegou no SAT: X — NF 1 aprovada ✅')
  })
})

describe('mensagemMudancaNf', () => {
  it('correção da mesma nota', () => {
    expect(mensagemMudancaNf({ tipo: 'correcao', ns: 'X', cliente: 'C', os: '9', nfDe: '1', nfPara: '1', situacaoDe: 'reprovada', situacaoPara: 'aprovada', motivos: [] }))
      .toBe('🧾 NF do SAT corrigida: X (C, OS 9) — NF 1 reprovada → aprovada ✅')
  })
  it('troca de nota', () => {
    expect(mensagemMudancaNf({ tipo: 'troca', ns: 'X', cliente: '', os: '', nfDe: '1', nfPara: '2', situacaoDe: 'reprovada', situacaoPara: 'reprovada', motivos: ['Sem CFOP'] }))
      .toBe('🧾 NF do SAT trocada: X — NF 1 (reprovada) substituída pela NF 2 reprovada ❌ (Sem CFOP)')
  })
})
