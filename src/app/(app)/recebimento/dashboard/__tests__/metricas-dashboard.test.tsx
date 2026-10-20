import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  usePathname: () => '/recebimento/dashboard',
}))

import { SecaoMetricas } from '../metricas-dashboard'
import { DashboardRecebimento } from '../dashboard-recebimento'
import { BarrasRanking, ColunasVolume, FaixasPendencias } from '../graficos-metricas'
import { FILTROS_LIMPOS } from '@/modules/recebimento/domain/dashboard'
import type { MetricasDashboard } from '@/modules/recebimento/domain/dashboard-metricas'

const NOVENTA = { ...FILTROS_LIMPOS, de: '2026-07-18', ate: '2026-10-15' }
const METRICAS: MetricasDashboard = {
  volume: {
    semanas: [{ inicio: '2026-09-07', itens: 12, embs: 3 }, { inicio: '2026-09-14', itens: 0, embs: 0 }],
    meses: [{ inicio: '2026-08-01', itens: 30, embs: 7 }, { inicio: '2026-09-01', itens: 40, embs: 9 }],
  },
  qualidade: {
    totais: { comResultado: 100, reprovados: 4, pecasRecebidas: 52000, pecasReprovadas: 380 },
    fornecedores: [
      { fornecedor: 'ACME', comResultado: 20, reprovados: 3 },
      { fornecedor: '', comResultado: 5, reprovados: 1 },
    ],
    materiais: [{ codigo: 'RWPC99', descricao: 'Capacitor', comResultado: 8, reprovados: 2 }],
    motivos: [{ motivo: 'Fora de especificação', itens: 3 }],
  },
  atraso: {
    totais: { comPrazo: 90, atrasados: 30, mediaDiasAtraso: 4.5 },
    fornecedores: [{ fornecedor: 'Vishay', comPrazo: 10, atrasados: 6, mediaDias: 5.2 }],
  },
  tempo: {
    recebimento: { n: 70, mediaDias: 1.8, medianaDias: 1 },
    qualidade: { n: 65, mediaDias: 3.2, medianaDias: 2.1 },
    parados: { dias: 7, recebimento: 4, qualidade: 9 },
    semTempo: 12,
  },
  pendencias: {
    total: 229,
    faixas: { noPrazo: 100, d1a7: 40, d8a30: 50, d30mais: 30, semPrevista: 9 },
    fornecedores: [{ fornecedor: 'Panasonic', pendentes: 12, atrasados: 8 }],
  },
}
const SEM_BASE: MetricasDashboard = {
  ...METRICAS,
  qualidade: { totais: { comResultado: 0, reprovados: 0, pecasRecebidas: 0, pecasReprovadas: 0 }, fornecedores: [], materiais: [], motivos: [] },
  atraso: { totais: { comPrazo: 0, atrasados: 0, mediaDiasAtraso: null }, fornecedores: [] },
  tempo: {
    recebimento: { n: 0, mediaDias: null, medianaDias: null },
    qualidade: { n: 0, mediaDias: null, medianaDias: null },
    parados: { dias: 7, recebimento: 0, qualidade: 0 },
    semTempo: 0,
  },
  volume: { semanas: [], meses: [] },
  pendencias: { total: 0, faixas: { noPrazo: 0, d1a7: 0, d8a30: 0, d30mais: 0, semPrevista: 0 }, fornecedores: [] },
}

function tela(props: Partial<{ filtros: typeof NOVENTA; metricas: MetricasDashboard | null; erro: string | null; paradoDias: number }> = {}) {
  return render(<SecaoMetricas filtros={NOVENTA} metricas={METRICAS} erro={null} paradoDias={7} {...props} />)
}

beforeEach(() => {
  push.mockReset()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe('os quatro números', () => {
  it('mostram % atrasados, taxa de reprovação, mediana e parados', () => {
    tela()
    expect(screen.getByText('33,3%')).toBeInTheDocument() // 30 de 90
    expect(screen.getByText('4%')).toBeInTheDocument() // 4 de 100
    expect(screen.getByText('380 de 52.000 peças reprovadas')).toBeInTheDocument()
    expect(screen.getAllByText('2,1 d').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Parados há mais de 7 dias')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument() // 4 + 9
    expect(screen.getByText('4 no Recebimento · 9 na Qualidade')).toBeInTheDocument()
  })
  it('sem base mostra "—", nunca zero', () => {
    tela({ metricas: SEM_BASE })
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText('0,0 d')).not.toBeInTheDocument()
  })
})

describe('Volume: alternador Semana | Mês', () => {
  it('começa em semanas e troca para meses', () => {
    tela()
    expect(screen.getByRole('button', { name: 'Semana' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Semana de 07/09/2026: 12 itens em 3 EMBs')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Mês' }))
    expect(screen.getByRole('button', { name: 'Mês' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Mês 09/2026: 40 itens em 9 EMBs')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^Semana de/)).not.toBeInTheDocument()
  })
  it('período sem chegada: texto claro', () => {
    tela({ metricas: SEM_BASE })
    expect(screen.getByText('Nenhum item no período.')).toBeInTheDocument()
  })
})

describe('Tempo: seletor de X dias navega pela URL', () => {
  it('trocar para 15 põe parado=15 e preserva os outros filtros', () => {
    tela({ filtros: { ...NOVENTA, emb: 'EMB2' } })
    fireEvent.change(screen.getByLabelText('Parado há mais de'), { target: { value: '15' } })
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?emb=EMB2&parado=15')
  })
  it('voltar para 7 tira o parado da URL', () => {
    tela({ paradoDias: 15 })
    fireEvent.change(screen.getByLabelText('Parado há mais de'), { target: { value: '7' } })
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard')
  })
  it('mostra as quatro opções', () => {
    tela()
    const opcoes = within(screen.getByLabelText('Parado há mais de')).getAllByRole('option')
    expect(opcoes.map((o) => o.textContent)).toEqual(['3 dias', '7 dias', '15 dias', '30 dias'])
  })
  it('avisa os itens sem tempo', () => {
    tela()
    expect(screen.getByText(/12 itens sem registro de entrada na Qualidade/)).toBeInTheDocument()
  })
})

describe('clicar filtra a página inteira', () => {
  it('fornecedor (Qualidade)', () => {
    tela()
    const lista = screen.getByRole('list', { name: 'Reprovados por fornecedor' })
    fireEvent.click(within(lista).getByRole('button', { name: /ACME/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?fornecedor=ACME')
  })
  it('material usa o filtro de código', () => {
    tela()
    fireEvent.click(screen.getByRole('button', { name: /RWPC99/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?codigo=RWPC99')
  })
  it('mantém o parado escolhido ao filtrar', () => {
    tela({ paradoDias: 30 })
    fireEvent.click(screen.getByRole('button', { name: /Vishay/ }))
    expect(push).toHaveBeenCalledWith('/recebimento/dashboard?fornecedor=Vishay&parado=30')
  })
  it('fornecedor em branco aparece como "(sem fornecedor)" e não é clicável', () => {
    tela()
    expect(screen.getAllByText('(sem fornecedor)')[0]!.closest('button')).toBeNull()
  })
  it('motivos são só leitura', () => {
    tela()
    const lista = screen.getByRole('list', { name: 'Motivos de reprovação' })
    expect(within(lista).queryByRole('button')).toBeNull()
    expect(within(lista).getByText('Fora de especificação')).toBeInTheDocument()
  })
})

describe('estados vazios e erro', () => {
  it('vazios com texto claro', () => {
    tela({ metricas: SEM_BASE })
    expect(screen.getByText('Nenhum fornecedor com item reprovado neste recorte.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum material com item reprovado neste recorte.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum motivo de reprovação registrado neste recorte.')).toBeInTheDocument()
    expect(screen.getByText('Nenhum fornecedor com atraso neste recorte.')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma pendência de chegada.')).toBeInTheDocument()
  })
  it('erro só da seção: mensagem em alerta, sem os blocos', () => {
    tela({ metricas: null, erro: 'Não foi possível carregar as métricas.' })
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar as métricas.')
    expect(screen.queryByText('Volume de chegadas')).not.toBeInTheDocument()
  })
  it('a tela principal segue de pé quando só as métricas falham', () => {
    render(<DashboardRecebimento filtros={NOVENTA}
      dados={{ totais: { itens: 9, comDivergencia: 6, semJustificativa: 4, positivas: 3, negativas: 3, embs: 4, foraDoRecortePorData: 0 }, fornecedores: [], semanas: [] }}
      opcoes={{ fornecedores: [], compradores: [] }} erro={null}
      metricas={null} erroMetricas="Não foi possível carregar as métricas." />)
    expect(screen.getByText('Itens')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar as métricas.')
  })
})

describe('Pendências', () => {
  it('cinco faixas com seus valores', () => {
    tela()
    const lista = screen.getByRole('list', { name: 'Pendências por faixa de atraso' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(5)
    expect(within(lista).getByText('Mais de 30 dias')).toBeInTheDocument()
    expect(screen.getByText(/229 itens abertos ainda não chegaram/)).toBeInTheDocument()
  })
})

describe('componentes soltos', () => {
  it('BarrasRanking marca o ativo', () => {
    render(<BarrasRanking linhas={[{ chave: 'A', rotulo: 'A', valor: 2, texto: 'x' }]} ativo="A" onClique={vi.fn()} vazio="vazio" />)
    expect(screen.getByRole('button', { name: /^A/ })).toHaveAttribute('aria-pressed', 'true')
  })
  it('ColunasVolume tem rótulo de grupo e colunas do mais antigo para o mais novo', () => {
    render(<ColunasVolume tipo="semana" periodos={METRICAS.volume.semanas} />)
    const itens = within(screen.getByRole('group', { name: 'Itens por semana de chegada' })).getAllByRole('listitem')
    expect(itens[0]).toHaveAttribute('aria-label', expect.stringContaining('07/09/2026'))
  })
  it('FaixasPendencias vazia', () => {
    render(<FaixasPendencias faixas={{ noPrazo: 0, d1a7: 0, d8a30: 0, d30mais: 0, semPrevista: 0 }} />)
    expect(screen.getByText('Nenhuma pendência de chegada.')).toBeInTheDocument()
  })
})
