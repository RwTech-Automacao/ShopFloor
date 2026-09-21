import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const buscarIntegracao = vi.fn()
const cancelarIntegracao = vi.fn()
vi.mock('@/modules/shopfloor/application/integracao-actions', () => ({
  buscarIntegracao: (...a: unknown[]) => buscarIntegracao(...a),
  cancelarIntegracao: (...a: unknown[]) => cancelarIntegracao(...a),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ConsultaIntegracaoForm } from '../consulta-integracao-form'

const DETALHE = {
  codigo: 'INT-20260917-133944-6056', dataHora: '2026-09-17T13:39:44Z', colaborador: 'Andreia', cliente: 'VMI',
  pmo: 'PMOC50_', op: '8504_', posto: 'Integração', produtoSn: '335001778', qtdPlacas: 1, observacao: '',
  itens: [{ tipo: 'Produto', pmo: 'PMOC50_', op: '8504_', sn: '335001778' }],
}

async function abrirDialogo() {
  render(<ConsultaIntegracaoForm podeCancelar />)
  fireEvent.change(screen.getByLabelText('SN do produto ou da placa'), { target: { value: '335001778' } })
  fireEvent.click(screen.getByRole('button', { name: /Buscar/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Cancelar integração' }))
}

describe('ConsultaIntegracaoForm — cancelar com motivo', () => {
  beforeEach(() => {
    buscarIntegracao.mockReset().mockResolvedValue({ ok: true, detalhes: [DETALHE] })
    cancelarIntegracao.mockReset()
  })

  it('não deixa confirmar sem motivo', async () => {
    await abrirDialogo()
    const botoes = screen.getAllByRole('button', { name: 'Cancelar integração' })
    expect(botoes[botoes.length - 1]).toBeDisabled()
  })

  it('envia o código e o motivo digitado', async () => {
    cancelarIntegracao.mockResolvedValue({ ok: true })
    await abrirDialogo()
    fireEvent.change(screen.getByLabelText('Motivo (obrigatório)'), { target: { value: 'placa bipada errada' } })
    const botoes = screen.getAllByRole('button', { name: 'Cancelar integração' })
    fireEvent.click(botoes[botoes.length - 1]!)
    await waitFor(() => expect(cancelarIntegracao).toHaveBeenCalledWith('INT-20260917-133944-6056', 'placa bipada errada'))
  })

  it('recusa do servidor (peça já avançou) aparece dentro do diálogo', async () => {
    cancelarIntegracao.mockResolvedValue({ ok: false, erro: 'Esta peça já passou por Embalagem depois da integração.' })
    await abrirDialogo()
    fireEvent.change(screen.getByLabelText('Motivo (obrigatório)'), { target: { value: 'teste' } })
    const botoes = screen.getAllByRole('button', { name: 'Cancelar integração' })
    fireEvent.click(botoes[botoes.length - 1]!)
    expect(await screen.findByText('Esta peça já passou por Embalagem depois da integração.')).toBeInTheDocument()
  })

  it('integração por hipótese mostra o asterisco e a observação', async () => {
    buscarIntegracao.mockResolvedValue({ ok: true, detalhes: [{ ...DETALHE, observacao: '* Associada por hipótese' }] })
    render(<ConsultaIntegracaoForm podeCancelar={false} />)
    fireEvent.change(screen.getByLabelText('SN do produto ou da placa'), { target: { value: '335001778' } })
    fireEvent.click(screen.getByRole('button', { name: /Buscar/ }))
    expect(await screen.findByText('INT-20260917-133944-6056*')).toBeInTheDocument()
    expect(screen.getByText('* Associada por hipótese')).toBeInTheDocument()
  })
})
