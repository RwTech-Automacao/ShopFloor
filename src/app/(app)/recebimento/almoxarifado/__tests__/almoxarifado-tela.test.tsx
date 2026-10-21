import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { listarPendenciasAlmoxarifado, detalharPendenciaAlmoxarifado, registrarEntradaAlmoxarifado, confirmarLoteAlmoxarifado } = vi.hoisted(() => ({
  listarPendenciasAlmoxarifado: vi.fn(),
  detalharPendenciaAlmoxarifado: vi.fn(),
  registrarEntradaAlmoxarifado: vi.fn(),
  confirmarLoteAlmoxarifado: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => ({
  listarPendenciasAlmoxarifado,
  detalharPendenciaAlmoxarifado,
  registrarEntradaAlmoxarifado,
  confirmarLoteAlmoxarifado,
}))

import { AlmoxarifadoTela } from '../almoxarifado-tela'
import { FRASE_ITEM_NAO_PENDENTE } from '@/modules/shopfloor/domain/almoxarifado'

const CAIXA = { pmo: 'PMO1', op: '100', tipo: 'caixa' as const, codigo: 'CX[1][40]100-PMO1', pecas: 40, amostra: null, loteId: null, em: '2026-10-21T15:30:00Z' }
const DETALHE = {
  tipo: 'caixa' as const, qtdOp: 200, recebidasOp: 80, postoAnterior: null, pecas: 40, sns: ['SN1'],
  em: '2026-10-21T15:30:00Z', fechadaPor: null, amostra: null, jaLancadas: 0,
}

const LOTE = { pmo: 'PMO2', op: '200', tipo: 'lote' as const, codigo: 'LOTE[ab12cd34][5]', pecas: 5, amostra: 5, loteId: 'l1', em: '2026-10-21T13:05:00Z' }
const DETALHE_LOTE = {
  tipo: 'lote' as const, qtdOp: 50, recebidasOp: 0, postoAnterior: null, pecas: 5,
  sns: ['a1', 'a2', 'a3', 'a4', 'a5'], em: '2026-10-21T13:05:00Z', fechadaPor: null, amostra: 5, jaLancadas: 0,
}

async function abrirCaixa() {
  fireEvent.click(await screen.findByRole('button', { name: /CX\[1\]\[40\]100-PMO1/ }))
  const c = await screen.findByPlaceholderText('Bipe o código da caixa')
  fireEvent.change(c, { target: { value: 'CX[1][40]100-PMO1' } })
  fireEvent.keyDown(c, { key: 'Enter' })
}

beforeEach(() => {
  vi.clearAllMocks()
  listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [CAIXA] })
  detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: DETALHE })
})

describe('AlmoxarifadoTela', () => {
  it('abre na lista e mostra erro de leitura como estado próprio', async () => {
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Falhou.' })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    expect(await screen.findByText('Falhou.')).toBeInTheDocument()
    expect(screen.queryByText('Nada esperando confirmação no Almoxarifado agora.')).not.toBeInTheDocument()
  })

  it('escolher um cartão abre a caixa; Voltar recarrega a lista', async () => {
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    fireEvent.click(await screen.findByRole('button', { name: /CX\[1\]\[40\]100-PMO1/ }))
    expect(await screen.findByText('Bipe este código para confirmar a entrada de 40 peças.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Voltar à lista/ }))
    expect(await screen.findByText('Esperando confirmação (1)')).toBeInTheDocument()
    expect(listarPendenciasAlmoxarifado).toHaveBeenCalledTimes(2)
  })

  it('confirmar volta à lista, recarrega e mostra o painel de resultado', async () => {
    registrarEntradaAlmoxarifado.mockImplementation(async () => {
      listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [] })
      return { ok: true, quantidade: 40, tipo: 'caixa' }
    })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    await abrirCaixa()
    expect(await screen.findByText('40 peças')).toBeInTheDocument()
    expect(screen.getByText('CX[1][40]100-PMO1')).toBeInTheDocument()
    expect(await screen.findByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
  })

  it('recusa mantém o cartão aberto e mostra o aviso', async () => {
    registrarEntradaAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Posto anterior não concluído.' })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    await abrirCaixa()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Posto anterior não concluído.'))
    expect(screen.getByText('Bipe este código para confirmar a entrada de 40 peças.')).toBeInTheDocument()
  })

  it('duas recargas em voo: a resposta antiga não sobrescreve a nova', async () => {
    let r1: (v: unknown) => void = () => {}
    let r2: (v: unknown) => void = () => {}
    listarPendenciasAlmoxarifado.mockReset()
    listarPendenciasAlmoxarifado
      .mockReturnValueOnce(Promise.resolve({ ok: true, pendencias: [CAIXA] })) // montagem
      .mockReturnValueOnce(new Promise((r) => { r1 = r }))
      .mockReturnValueOnce(new Promise((r) => { r2 = r }))
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    await screen.findByText('Esperando confirmação (1)')
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    r2({ ok: true, pendencias: [] })
    await screen.findByText('Nada esperando confirmação no Almoxarifado agora.')
    r1({ ok: true, pendencias: [CAIXA] })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
  })

  it('abrir outro cartão mantém o resultado da última ação até o próximo bipe', async () => {
    const OUTRA = { ...CAIXA, codigo: 'CX[2][10]100-PMO1', pecas: 10 }
    registrarEntradaAlmoxarifado.mockImplementation(async () => {
      listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [OUTRA] })
      return { ok: true, quantidade: 40, tipo: 'caixa' }
    })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    await abrirCaixa()
    expect(await screen.findByText('40 peças')).toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: /CX\[2\]\[10\]100-PMO1/ }))
    await screen.findByPlaceholderText('Bipe o código da caixa')
    expect(screen.getByText('40 peças')).toBeInTheDocument()
  })

  it('recusa "não está mais esperando" ao confirmar volta à lista e recarrega', async () => {
    registrarEntradaAlmoxarifado.mockImplementation(async () => {
      listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [] })
      return { ok: false, erro: FRASE_ITEM_NAO_PENDENTE }
    })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    await abrirCaixa()
    expect(await screen.findByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(FRASE_ITEM_NAO_PENDENTE)
    expect(listarPendenciasAlmoxarifado).toHaveBeenCalledTimes(2)
  })

  it('item não pendente no detalhe: frase e Voltar à lista recarrega', async () => {
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: false, erro: FRASE_ITEM_NAO_PENDENTE })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    fireEvent.click(await screen.findByRole('button', { name: /CX\[1\]\[40\]100-PMO1/ }))
    expect(await screen.findByText(FRASE_ITEM_NAO_PENDENTE)).toBeInTheDocument()
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Voltar à lista' }))
    expect(await screen.findByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
    expect(listarPendenciasAlmoxarifado).toHaveBeenCalledTimes(2)
  })

  it('lote: escolher abre o lote; confirmar com todos os SNs bipados volta à lista e mostra o resultado', async () => {
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [LOTE] })
    detalharPendenciaAlmoxarifado.mockResolvedValue({ ok: true, detalhe: DETALHE_LOTE })
    confirmarLoteAlmoxarifado.mockImplementation(async () => {
      listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [] })
      return { ok: true, quantidade: 5, lote: 'LOTE[ab12cd34][5]' }
    })
    render(<AlmoxarifadoTela colaborador="Maria" posto="Almoxarifado" />)
    fireEvent.click(await screen.findByRole('button', { name: /LOTE\[ab12cd34\]\[5\]/ }))
    const c = await screen.findByPlaceholderText('Bipe um número de série do lote')
    for (const sn of ['a1', 'a2', 'a3', 'a4', 'a5']) {
      fireEvent.change(c, { target: { value: sn } })
      fireEvent.keyDown(c, { key: 'Enter' })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar lote' }))
    expect(await screen.findByText('5 peças')).toBeInTheDocument()
    expect(await screen.findByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
    expect(screen.getByText('LOTE[ab12cd34][5]')).toBeInTheDocument()
  })
})
