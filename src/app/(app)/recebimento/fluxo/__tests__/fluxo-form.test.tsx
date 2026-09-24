import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { CaixaFluxo, ItemFluxo } from '@/modules/recebimento/infra/fluxo-repository'

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { carregarFluxoEmbAction, carregarItensCaixaAction } = vi.hoisted(() => ({
  carregarFluxoEmbAction: vi.fn(),
  carregarItensCaixaAction: vi.fn(),
}))
vi.mock('@/modules/recebimento/application/fluxo-actions', () => ({
  carregarFluxoEmbAction,
  carregarItensCaixaAction,
}))

import { FluxoForm } from '../fluxo-form'

function caixa(parcial: Partial<CaixaFluxo> & { etapa: CaixaFluxo['etapa'] }): CaixaFluxo {
  return { itens: 0, divergentes: 0, mediaSegundos: null, maiorSegundos: null, semTempo: 0, ...parcial }
}

const CAIXAS: CaixaFluxo[] = [
  caixa({ etapa: 'recebimento', itens: 4, mediaSegundos: 3 * 86400, maiorSegundos: 10 * 86400 }),
  caixa({ etapa: 'qualidade', itens: 3, divergentes: 1, mediaSegundos: 4 * 86400, maiorSegundos: 4 * 86400, semTempo: 1 }),
  caixa({ etapa: 'almoxarifado', itens: 2 }),
  caixa({ etapa: 'reprovado', itens: 1, divergentes: 1 }),
]

const ITEM: ItemFluxo = {
  processoId: 'p1',
  numero: 123,
  item: 'CAPJ91',
  descricao: 'CAPACITOR 100uF',
  quantidadePedido: 500,
  quantidadeRecebida: 490,
  divergencia: '-10',
  resultado: '',
  desde: '2026-09-20T12:00:00Z',
  segundos: 4 * 86400,
}

beforeEach(() => {
  vi.clearAllMocks()
  carregarFluxoEmbAction.mockResolvedValue({ ok: true, caixas: CAIXAS })
  carregarItensCaixaAction.mockResolvedValue({ ok: true, itens: [ITEM] })
})

/** Abre o combobox de EMB e escolhe a primeira. */
async function escolherEmb() {
  render(<FluxoForm embs={['EMB390', 'EMB100']} />)
  fireEvent.click(screen.getByText('Selecione a EMB'))
  fireEvent.click(await screen.findByText('EMB390'))
  await waitFor(() => expect(carregarFluxoEmbAction).toHaveBeenCalledWith('EMB390'))
}

describe('FluxoForm', () => {
  it('só busca depois de escolher a EMB', () => {
    render(<FluxoForm embs={['EMB390']} />)
    expect(carregarFluxoEmbAction).not.toHaveBeenCalled()
  })

  it('mostra as quatro caixas com a contagem e o tempo de cada uma', async () => {
    await escolherEmb()
    expect(await screen.findByText('Recebimento')).toBeInTheDocument()
    expect(screen.getByText('Qualidade')).toBeInTheDocument()
    expect(screen.getByText('Almoxarifado')).toBeInTheDocument()
    // Reprovado é saída lateral, fim de linha.
    expect(screen.getByText('Reprovado na Qualidade')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()
    expect(screen.getByText('10 d')).toBeInTheDocument() // mais antigo do Recebimento
    // Caixa sem tempo nenhum mostra travessão, não zero.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('divergência é contador à parte, não caixa', async () => {
    await escolherEmb()
    expect(await screen.findByText('2 itens com divergência')).toBeInTheDocument()
    expect(screen.getByText('10 itens na EMB EMB390 ·')).toBeInTheDocument()
  })

  it('clicar numa caixa lista os itens dela, e clicar de novo fecha', async () => {
    await escolherEmb()
    fireEvent.click(await screen.findByText('Qualidade'))
    await waitFor(() => expect(carregarItensCaixaAction).toHaveBeenCalledWith('EMB390', 'qualidade'))
    expect(await screen.findByText('Itens em Qualidade')).toBeInTheDocument()
    const tabela = within(screen.getByRole('table'))
    expect(tabela.getByText('CAPACITOR 100uF')).toBeInTheDocument()
    expect(tabela.getByText('#123')).toBeInTheDocument()
    expect(tabela.getByText('4 d')).toBeInTheDocument() // há quanto tempo está na etapa
    expect(tabela.getByText('-10')).toBeInTheDocument() // a marca de divergência no item

    fireEvent.click(screen.getByText('Qualidade'))
    await waitFor(() => expect(screen.queryByText('Itens em Qualidade')).not.toBeInTheDocument())
  })

  it('item sem tempo conhecido mostra travessão na lista da caixa', async () => {
    carregarItensCaixaAction.mockResolvedValue({
      ok: true,
      itens: [{ ...ITEM, divergencia: '', desde: null, segundos: null }],
    })
    await escolherEmb()
    fireEvent.click(await screen.findByText('Qualidade'))
    expect(await screen.findByText('Itens em Qualidade')).toBeInTheDocument()
    const tabela = within(screen.getByRole('table'))
    expect(tabela.getByText('500')).toBeInTheDocument()
    // Sem histórico o tempo é "—", não zero — e sem a marca de divergência.
    expect(tabela.getByText('—')).toBeInTheDocument()
    expect(tabela.queryByText('-10')).not.toBeInTheDocument()
  })

  it('erro da action aparece na tela em vez de quebrar', async () => {
    carregarFluxoEmbAction.mockResolvedValue({ ok: false, erro: 'Não foi possível carregar o fluxo agora.' })
    render(<FluxoForm embs={['EMB390']} />)
    fireEvent.click(screen.getByText('Selecione a EMB'))
    fireEvent.click(await screen.findByText('EMB390'))
    expect(await screen.findByText('Não foi possível carregar o fluxo agora.')).toBeInTheDocument()
  })
})
