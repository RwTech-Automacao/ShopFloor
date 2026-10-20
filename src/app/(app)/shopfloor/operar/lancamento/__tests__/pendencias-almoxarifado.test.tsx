import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { listarPendenciasAlmoxarifado } = vi.hoisted(() => ({ listarPendenciasAlmoxarifado: vi.fn() }))
vi.mock('@/modules/shopfloor/application/almoxarifado-actions', () => ({ listarPendenciasAlmoxarifado }))

import { PendenciasAlmoxarifado } from '../pendencias-almoxarifado'

const CAIXA = { pmo: 'PMOT02', op: '9901', tipo: 'caixa' as const, codigo: 'CX[2][2]9901-PMOT02', pecas: 2, amostra: null }
const LOTE = { pmo: 'PMOT05', op: '9950', tipo: 'lote' as const, codigo: 'LOTE[ab12cd34][10]', pecas: 10, amostra: 3 }

beforeEach(() => vi.clearAllMocks())

describe('PendenciasAlmoxarifado', () => {
  it('lista as pendências de todas as OPs, agrupadas, antes de qualquer bipe', async () => {
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [CAIXA, LOTE] })
    render(<PendenciasAlmoxarifado onEscolher={() => {}} />)
    expect(await screen.findByText('CX[2][2]9901-PMOT02')).toBeInTheDocument()
    expect(screen.getByText('LOTE[ab12cd34][10]')).toBeInTheDocument()
    expect(screen.getByText('OP 9901 · PMOT02')).toBeInTheDocument()
    expect(screen.getByText('OP 9950 · PMOT05')).toBeInTheDocument()
    expect(screen.getByText(/10 peças · amostra 3/)).toBeInTheDocument()
    expect(screen.getByText('Esperando confirmação (2)')).toBeInTheDocument()
  })

  it('escolher uma linha entrega a OP dela', async () => {
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [CAIXA] })
    const onEscolher = vi.fn()
    render(<PendenciasAlmoxarifado onEscolher={onEscolher} />)
    fireEvent.click(await screen.findByText('CX[2][2]9901-PMOT02'))
    expect(onEscolher).toHaveBeenCalledWith('PMOT02', '9901')
  })

  it('sem pendência: diz que não há nada esperando', async () => {
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: true, pendencias: [] })
    render(<PendenciasAlmoxarifado onEscolher={() => {}} />)
    expect(await screen.findByText('Nada esperando confirmação no Almoxarifado agora.')).toBeInTheDocument()
  })

  it('falha de leitura é erro visível, nunca "nada esperando"', async () => {
    listarPendenciasAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Você não tem permissão para esta ação.' })
    render(<PendenciasAlmoxarifado onEscolher={() => {}} />)
    expect(await screen.findByText('Você não tem permissão para esta ação.')).toBeInTheDocument()
    expect(screen.queryByText(/Nada esperando/)).not.toBeInTheDocument()
  })

  it('exceção na chamada também vira erro, e Atualizar consulta de novo', async () => {
    listarPendenciasAlmoxarifado.mockRejectedValueOnce(new Error('rede')).mockResolvedValue({ ok: true, pendencias: [CAIXA] })
    render(<PendenciasAlmoxarifado onEscolher={() => {}} />)
    expect(await screen.findByText(/Não foi possível carregar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar' }))
    await waitFor(() => expect(screen.getByText('CX[2][2]9901-PMOT02')).toBeInTheDocument())
  })
})
