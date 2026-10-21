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

const CAIXA = { pmo: 'PMO1', op: '100', tipo: 'caixa' as const, codigo: 'CX[1][40]100-PMO1', pecas: 40, amostra: null, loteId: null, em: '2026-10-21T15:30:00Z' }
const DETALHE = {
  tipo: 'caixa' as const, qtdOp: 200, recebidasOp: 80, postoAnterior: null, pecas: 40, sns: ['SN1'],
  em: '2026-10-21T15:30:00Z', fechadaPor: null, amostra: null, jaLancadas: 0,
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
})
