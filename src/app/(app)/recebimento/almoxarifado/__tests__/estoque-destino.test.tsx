import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const acoes = vi.hoisted(() => ({
  registrarEntradaAlmoxarifado: vi.fn(),
  confirmarLoteAlmoxarifado: vi.fn(),
  detalharPendenciaAlmoxarifado: vi.fn(),
  estoqueDestinoDaOp: vi.fn(),
  listarNecessidadesAlmoxarifado: vi.fn(),
  listarLotesAlmoxarifado: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => acoes)

import { CaixaAberta } from '../caixa-aberta'
import { LoteAberto } from '../lote-aberto'
import { PecasAbertas } from '../pecas-abertas'
import { AlmoxarifadoPanel } from '../../../shopfloor/operar/lancamento/almoxarifado-panel'
import type { PendenciaAlmoxarifado } from '@/modules/shopfloor/domain/almoxarifado'

const CAIXA: PendenciaAlmoxarifado = {
  pmo: 'PMO1', op: '100', tipo: 'caixa', codigo: 'CX[1][40]100-PMO1', pecas: 40, amostra: null, loteId: null, em: null,
}
const LOTE: PendenciaAlmoxarifado = {
  pmo: 'PMO2', op: '200', tipo: 'lote', codigo: 'LOTE[ab12cd34][2]', pecas: 2, amostra: 2, loteId: 'l1', em: null,
}
const PECAS: PendenciaAlmoxarifado = {
  pmo: 'PMO3', op: '300', tipo: 'peca', codigo: 'AVULSAS', pecas: 3, amostra: null, loteId: null, em: null,
}
const detalhe = (tipo: 'caixa' | 'lote' | 'peca', extra = {}) => ({
  tipo, qtdOp: 100, recebidasOp: 0, postoAnterior: null, pecas: 3, sns: ['a1', 'a2'], em: null, fechadaPor: null,
  amostra: 2, jaLancadas: 0, ...extra,
})

const COM_EINTER = (padrao: 'PA' | 'EINTER') => ({ ok: true, einterDisponivel: true, padrao })
const SEM_EINTER = { ok: true, einterDisponivel: false, padrao: 'PA' }

const grupo = () => screen.queryByRole('group', { name: 'Estoque de destino' })
// Os botões levam o NOME COMPLETO do estoque (pedido de 06/11/2026), não só a sigla.
const NOME_DO_BOTAO = { PA: 'PA – Produto acabado', EINTER: 'EINTER – Estoque intermediário' } as const
const botao = (nome: 'PA' | 'EINTER') => screen.getByRole('button', { name: NOME_DO_BOTAO[nome] })

beforeEach(() => {
  vi.clearAllMocks()
  acoes.listarNecessidadesAlmoxarifado.mockResolvedValue({ ok: true, necessidades: [] })
  acoes.listarLotesAlmoxarifado.mockResolvedValue({ ok: true, lotes: [] })
})

describe('caixa aberta', () => {
  beforeEach(() => acoes.detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: detalhe('caixa') }))

  it('EINTER indisponível: nada de seletor e a action é chamada sem estoque (a tela é a de sempre)', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue(SEM_EINTER)
    acoes.registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 40, tipo: 'caixa', estoque: 'PA' })
    const onConfirmado = vi.fn()
    render(<CaixaAberta item={CAIXA} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={onConfirmado} onVoltar={vi.fn()} />)
    const campo = await screen.findByPlaceholderText('Bipe o código da caixa')
    await waitFor(() => expect(acoes.estoqueDestinoDaOp).toHaveBeenCalledWith('PMO1', '100'))
    expect(grupo()).toBeNull()
    fireEvent.change(campo, { target: { value: CAIXA.codigo } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(onConfirmado).toHaveBeenCalled())
    expect(acoes.registrarEntradaAlmoxarifado.mock.calls[0]![0].estoque).toBeUndefined()
    expect(onConfirmado.mock.calls[0]![0].estoque).toBeUndefined()
  })

  it('EINTER disponível: vem pré-selecionado com o último da OP e vai para a action', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue(COM_EINTER('EINTER'))
    acoes.registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 40, tipo: 'caixa', estoque: 'EINTER' })
    const onConfirmado = vi.fn()
    render(<CaixaAberta item={CAIXA} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={onConfirmado} onVoltar={vi.fn()} />)
    const campo = await screen.findByPlaceholderText('Bipe o código da caixa')
    await waitFor(() => expect(grupo()).not.toBeNull())
    expect(botao('EINTER')).toHaveAttribute('aria-pressed', 'true')
    expect(botao('PA')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.change(campo, { target: { value: CAIXA.codigo } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(onConfirmado).toHaveBeenCalled())
    expect(acoes.registrarEntradaAlmoxarifado.mock.calls[0]![0].estoque).toBe('EINTER')
    expect(onConfirmado.mock.calls[0]![0].estoque).toBe('EINTER')
  })

  it('a pessoa troca para PA e é o PA que vai', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue(COM_EINTER('EINTER'))
    acoes.registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 40, tipo: 'caixa', estoque: 'PA' })
    const onConfirmado = vi.fn()
    render(<CaixaAberta item={CAIXA} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={onConfirmado} onVoltar={vi.fn()} />)
    const campo = await screen.findByPlaceholderText('Bipe o código da caixa')
    await waitFor(() => expect(grupo()).not.toBeNull())
    fireEvent.click(botao('PA'))
    expect(botao('PA')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.change(campo, { target: { value: CAIXA.codigo } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(onConfirmado).toHaveBeenCalled())
    expect(acoes.registrarEntradaAlmoxarifado.mock.calls[0]![0].estoque).toBe('PA')
    expect(onConfirmado.mock.calls[0]![0].estoque).toBe('PA')
  })

  it('primeira vez na OP: PA pré-selecionado; e a consulta do padrão falhar não trava nada', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue(COM_EINTER('PA'))
    const { unmount } = render(<CaixaAberta item={CAIXA} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={vi.fn()} onVoltar={vi.fn()} />)
    await waitFor(() => expect(grupo()).not.toBeNull())
    expect(botao('PA')).toHaveAttribute('aria-pressed', 'true')
    unmount()

    acoes.estoqueDestinoDaOp.mockRejectedValue(new Error('rede'))
    render(<CaixaAberta item={CAIXA} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={vi.fn()} onVoltar={vi.fn()} />)
    expect(await screen.findByPlaceholderText('Bipe o código da caixa')).toBeInTheDocument()
    expect(grupo()).toBeNull()
  })

  it('aviso de consulta falha aparece junto do seletor', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue({ ...COM_EINTER('PA'), aviso: 'Não foi possível ver o último estoque desta OP. Confira o estoque escolhido antes de confirmar.' })
    render(<CaixaAberta item={CAIXA} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={vi.fn()} onVoltar={vi.fn()} />)
    expect(await screen.findByText(/Confira o estoque escolhido/)).toBeInTheDocument()
  })
})

describe('lote aberto', () => {
  it('manda o estoque escolhido ao confirmar o lote', async () => {
    acoes.detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: detalhe('lote', { pecas: 2 }) })
    acoes.estoqueDestinoDaOp.mockResolvedValue(COM_EINTER('EINTER'))
    acoes.confirmarLoteAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 2, lote: LOTE.codigo, estoque: 'EINTER' })
    const onConfirmado = vi.fn()
    render(<LoteAberto item={LOTE} colaborador="Ana" posto="Almoxarifado" onResultado={vi.fn()} onConfirmado={onConfirmado} onVoltar={vi.fn()} />)
    const campo = await screen.findByPlaceholderText('Bipe um número de série do lote')
    await waitFor(() => expect(grupo()).not.toBeNull())
    for (const sn of ['a1', 'a2']) {
      fireEvent.change(campo, { target: { value: sn } })
      fireEvent.keyDown(campo, { key: 'Enter' })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar lote' }))
    await waitFor(() => expect(onConfirmado).toHaveBeenCalled())
    expect(acoes.confirmarLoteAlmoxarifado.mock.calls[0]![0].estoque).toBe('EINTER')
    expect(onConfirmado.mock.calls[0]![0].estoque).toBe('EINTER')
  })
})

describe('peças avulsas', () => {
  it('manda o estoque em cada bipe e o resultado diz em qual foi', async () => {
    acoes.detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: detalhe('peca', { pecas: 3 }) })
    acoes.estoqueDestinoDaOp.mockResolvedValue(COM_EINTER('EINTER'))
    acoes.registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie', estoque: 'EINTER' })
    const onResultado = vi.fn()
    render(<PecasAbertas item={PECAS} colaborador="Ana" posto="Almoxarifado" onResultado={onResultado} onVoltar={vi.fn()} />)
    const campo = await screen.findByPlaceholderText('Bipe o número de série da peça')
    await waitFor(() => expect(grupo()).not.toBeNull())
    fireEvent.change(campo, { target: { value: 'SN1' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(onResultado).toHaveBeenCalled())
    expect(acoes.registrarEntradaAlmoxarifado.mock.calls[0]![0].estoque).toBe('EINTER')
    expect(onResultado.mock.calls[0]![0].chips).toContainEqual({ rotulo: 'Estoque', valor: 'EINTER' })
  })
})

describe('painel do posto Almoxarifado (Lançamento)', () => {
  const PROPS = { colaborador: 'Maria', pmo: 'PMO1', op: '12345', posto: 'Almoxarifado' }

  it('bipe de caixa com EINTER escolhido: manda o estoque e o resultado mostra em qual foi', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue(COM_EINTER('PA'))
    acoes.registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 14, tipo: 'caixa', estoque: 'EINTER' })
    render(<AlmoxarifadoPanel {...PROPS} />)
    await waitFor(() => expect(grupo()).not.toBeNull())
    expect(botao('PA')).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(botao('EINTER'))
    const campo = screen.getByPlaceholderText('Bipe o Nº de Série ou o código da caixa')
    fireEvent.change(campo, { target: { value: 'CX[1][14]12345-PMO1' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    await waitFor(() => expect(acoes.registrarEntradaAlmoxarifado).toHaveBeenCalled())
    expect(acoes.registrarEntradaAlmoxarifado.mock.calls[0]![0].estoque).toBe('EINTER')
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('EINTER')
  })

  it('EINTER indisponível: sem seletor e sem chip de estoque no resultado', async () => {
    acoes.estoqueDestinoDaOp.mockResolvedValue(SEM_EINTER)
    acoes.registrarEntradaAlmoxarifado.mockResolvedValue({ ok: true, quantidade: 1, tipo: 'serie', estoque: 'PA' })
    render(<AlmoxarifadoPanel {...PROPS} />)
    const campo = screen.getByPlaceholderText('Bipe o Nº de Série ou o código da caixa')
    await waitFor(() => expect(acoes.estoqueDestinoDaOp).toHaveBeenCalled())
    fireEvent.change(campo, { target: { value: 'SN1' } })
    fireEvent.keyDown(campo, { key: 'Enter' })
    const status = await screen.findByRole('status')
    expect(grupo()).toBeNull()
    expect(status).not.toHaveTextContent('Estoque')
    expect(acoes.registrarEntradaAlmoxarifado.mock.calls[0]![0].estoque).toBeUndefined()
  })
})
