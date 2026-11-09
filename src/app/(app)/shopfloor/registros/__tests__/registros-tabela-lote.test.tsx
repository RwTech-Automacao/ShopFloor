import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegistroRow } from '@/modules/shopfloor/infra/registros-repository'

const { cancelavelInfo, cancelarLancamento, cancelarCaixaAlmoxarifado, cancelarLoteAlmoxarifado, refresh } =
  vi.hoisted(() => ({
    cancelavelInfo: vi.fn(),
    cancelarLancamento: vi.fn(),
    cancelarCaixaAlmoxarifado: vi.fn(),
    cancelarLoteAlmoxarifado: vi.fn(),
    refresh: vi.fn(),
  }))
vi.mock('@/modules/shopfloor/application/cancelamento-actions', () => ({
  cancelavelInfo, cancelarLancamento, cancelarCaixaAlmoxarifado, cancelarLoteAlmoxarifado,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { RegistrosTabela } from '../registros-tabela'

const LINHA: RegistroRow = {
  id: 'r1', data_hora: '2026-10-20T12:00:00Z', colaborador: 'Ana', posto: 'Almoxarifado', pmo: 'PMOL01',
  op: '9201', cliente: 'Cliente L', numero_caixa: '', qtd_por_caixa: null, status: '', numero_serie: '7003',
  codigo_defeito: '', posicao: '', tipo_defeito: '', nqa_visual: '', nqa_funcional: '', id_integracao: '',
  reparo_conserto: '', reparo_posicao: '', posto_origem: '', data_hora_origem: null, posto_retorno: null,
}

function abrirDetalhe() {
  fireEvent.click(screen.getByRole('button', { name: 'Detalhes do registro 7003' }))
}

// A RolagemDupla da tabela mede a largura com ResizeObserver, que o jsdom não tem.
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

beforeEach(() => {
  vi.clearAllMocks()
})

describe('RegistrosTabela — entrada de LOTE do Almoxarifado (0156)', () => {
  it('oferece "Cancelar o lote inteiro (N peças)" em qualquer linha do lote', async () => {
    cancelavelInfo.mockResolvedValue({ podeCancelar: true, lote: { rotulo: 'LOTE[abcd1234][5]', pecas: 5 } })
    render(<RegistrosTabela linhas={[LINHA]} podeAdministrar />)
    abrirDetalhe()

    expect(await screen.findByRole('button', { name: 'Cancelar o lote inteiro (5 peças)' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancelar lançamento' })).toBeNull()
  })

  it('o diálogo diz o lote e quantas peças saem, exige motivo e cancela o lote inteiro', async () => {
    cancelavelInfo.mockResolvedValue({ podeCancelar: true, lote: { rotulo: 'LOTE[abcd1234][5]', pecas: 5 } })
    cancelarLoteAlmoxarifado.mockResolvedValue({ ok: true, canceladas: 5 })
    render(<RegistrosTabela linhas={[LINHA]} podeAdministrar />)
    abrirDetalhe()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar o lote inteiro (5 peças)' }))

    expect(await screen.findByRole('heading', { name: 'Cancelar o lote inteiro' })).toBeInTheDocument()
    expect(screen.getByText('LOTE[abcd1234][5]')).toBeInTheDocument()
    expect(screen.getByText(/5 peças do lote/)).toBeInTheDocument()
    const confirmar = screen.getByRole('button', { name: 'Confirmar cancelamento' })
    expect(confirmar).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo (obrigatório)'), { target: { value: 'lote errado' } })
    fireEvent.click(confirmar)

    await waitFor(() => expect(cancelarLoteAlmoxarifado).toHaveBeenCalledWith('r1', 'lote errado'))
    expect(cancelarLancamento).not.toHaveBeenCalled()
    expect(cancelarCaixaAlmoxarifado).not.toHaveBeenCalled()
    await waitFor(() => expect(refresh).toHaveBeenCalled())
  })

  it('erro da RPC aparece no diálogo', async () => {
    cancelavelInfo.mockResolvedValue({ podeCancelar: true, lote: { rotulo: 'LOTE[abcd1234][5]', pecas: 5 } })
    cancelarLoteAlmoxarifado.mockResolvedValue({ ok: false, erro: 'Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.' })
    render(<RegistrosTabela linhas={[LINHA]} podeAdministrar />)
    abrirDetalhe()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar o lote inteiro (5 peças)' }))
    fireEvent.change(screen.getByLabelText('Motivo (obrigatório)'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar cancelamento' }))

    expect(await screen.findByText('Só o bipe mais recente do SN pode ser cancelado — cancele o mais recente primeiro.')).toBeInTheDocument()
  })

  it('linha que não é de lote continua com "Cancelar lançamento"', async () => {
    cancelavelInfo.mockResolvedValue({ podeCancelar: true })
    render(<RegistrosTabela linhas={[LINHA]} podeAdministrar />)
    abrirDetalhe()
    expect(await screen.findByRole('button', { name: 'Cancelar lançamento' })).toBeEnabled()
  })
})
