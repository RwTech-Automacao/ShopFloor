import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// NQA com placas por painel (0166): a amostra exigida é em PLACAS e cada painel amostrado vale as
// placas dele. O painel nunca compara o nº de SNs bipados com o total em placas.
vi.mock('@/modules/shopfloor/application/nqa-caixa-actions', () => ({
  carregarNqaCaixa: vi.fn(),
  finalizarNqaCaixa: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/nqa-individual-actions', () => ({
  carregarLoteNqaIndividual: vi.fn(),
  finalizarNqaIndividual: vi.fn(),
  validarBipeLoteIndividual: vi.fn(),
}))
vi.mock('server-only', () => ({}))

import { NqaCaixaPanel } from '../nqa-caixa-panel'
import { NqaIndividualPanel } from '../nqa-individual-panel'

const CTX = { pmo: 'PMOP1', op: '7101', posto: 'Inspeção NQA', cliente: 'C', colaborador: 'Q', postos: ['Teste', 'Embalagem', 'Inspeção NQA'] }
const aprovada = (sn: string) => ({ snNorm: sn, visual: 'Aprovado', funcional: 'Aprovado', observacao: '' })
const pesos = (sns: string[], n: number) => Object.fromEntries(sns.map((s) => [s, n]))
const SNS = Array.from({ length: 10 }, (_, i) => `P${i}`)

function salvarCaixa(caixa: Record<string, unknown>, amostras: ReturnType<typeof aprovada>[]) {
  localStorage.setItem('sf:nqa-progresso', JSON.stringify({
    colaborador: 'Q', cliente: 'C', pmo: CTX.pmo, op: CTX.op, posto: CTX.posto,
    caixa: { numeroCaixa: 'CX[1][500]7101-PMOP1', postoEmbalagem: 'Embalagem', jaInspecionada: false,
             pendentesReteste: [], postoReteste: '', snsNorm: SNS, ...caixa },
    amostras, selecionados: [], salvoEm: Date.now(),
  }))
}
function salvarLote(lote: Record<string, unknown>, amostras: ReturnType<typeof aprovada>[]) {
  localStorage.setItem('sf:nqa-individual-progresso', JSON.stringify({
    colaborador: 'Q', cliente: 'C', pmo: CTX.pmo, op: CTX.op, posto: CTX.posto,
    qtdLote: '4', snsLote: [], lote: { snsNorm: SNS.slice(0, 4), ...lote },
    amostras, selecionados: [], salvoEm: Date.now(),
  }))
}

describe('NqaCaixaPanel — amostra em placas', () => {
  beforeEach(() => localStorage.clear())

  it('caixa de 10 painéis × 50 (amostra 50): 1 painel aprovado completa a amostra', () => {
    salvarCaixa({ qtd: 500, amostra: 50, pecasPorSn: pesos(SNS, 50) }, [aprovada('P0')])
    render(<NqaCaixaPanel {...CTX} />)
    expect(screen.getByText('50 / 50 amostras')).toBeTruthy()
    expect(screen.getByText('Amostra completa')).toBeTruthy()
    expect(screen.getByText(/500 peças · amostra: 50/)).toBeTruthy()
  })

  it('N = 1 (amostra 3): 1 amostra não completa, como antes', () => {
    salvarCaixa({ qtd: 10, amostra: 3, pecasPorSn: pesos(SNS, 1) }, [aprovada('P0')])
    render(<NqaCaixaPanel {...CTX} />)
    expect(screen.getByText('1 / 3 amostras')).toBeTruthy()
    expect(screen.getByText('Inspecionando…')).toBeTruthy()
  })

  it('progresso salvo antes das placas (sem pecasPorSn): cada amostra vale 1', () => {
    salvarCaixa({ qtd: 10, amostra: 3 }, [aprovada('P0'), aprovada('P1'), aprovada('P2')])
    render(<NqaCaixaPanel {...CTX} />)
    expect(screen.getByText('3 / 3 amostras')).toBeTruthy()
    expect(screen.getByText('Amostra completa')).toBeTruthy()
  })
})

describe('NqaIndividualPanel — amostra em placas', () => {
  beforeEach(() => localStorage.clear())

  it('lote de 4 painéis × 50 (amostra 32): 1 painel aprovado completa a amostra', () => {
    salvarLote({ qtd: 200, amostra: 32, pecasPorSn: pesos(SNS.slice(0, 4), 50) }, [aprovada('P0')])
    render(<NqaIndividualPanel {...CTX} />)
    expect(screen.getByText('50 / 32 amostras')).toBeTruthy()
    expect(screen.getByText('Amostra completa')).toBeTruthy()
    expect(screen.getByText(/Lote — 200 peças/)).toBeTruthy()
  })

  it('N = 1 (amostra 2): 1 amostra não completa, como antes', () => {
    salvarLote({ qtd: 4, amostra: 2, pecasPorSn: pesos(SNS.slice(0, 4), 1) }, [aprovada('P0')])
    render(<NqaIndividualPanel {...CTX} />)
    expect(screen.getByText('1 / 2 amostras')).toBeTruthy()
    expect(screen.getByText('Inspecionando…')).toBeTruthy()
  })
})
