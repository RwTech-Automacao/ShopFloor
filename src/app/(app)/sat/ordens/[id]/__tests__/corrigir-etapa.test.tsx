import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { toast } from 'sonner'
import { corrigirEtapaAction } from '@/modules/sat/application/ordens-actions'
import { CorrigirEtapa } from '../corrigir-etapa'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/sat/application/ordens-actions', () => ({ corrigirEtapaAction: vi.fn(async () => ({ ok: true, valor: null })) }))

const OS = '00000000-0000-0000-0000-0000000000a1'
beforeEach(() => vi.clearAllMocks())

describe('CorrigirEtapa', () => {
  it('abre, escolhe a etapa, escreve o motivo e confirma', async () => {
    render(<CorrigirEtapa ordemId={OS} etapaAtual="qualidade" />)
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir etapa' }))
    fireEvent.change(screen.getByLabelText('Nova etapa'), { target: { value: 'em_manutencao' } })
    fireEvent.change(screen.getByLabelText('Motivo da correção'), { target: { value: 'qualidade achou outro defeito' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    await waitFor(() => expect(corrigirEtapaAction).toHaveBeenCalledWith(OS, 'em_manutencao', 'qualidade achou outro defeito'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Etapa corrigida.'))
  })
  it('erro da action vira toast de erro', async () => {
    vi.mocked(corrigirEtapaAction).mockResolvedValueOnce({ ok: false, erro: 'Escreva o motivo da correção (3 a 500 caracteres).' })
    render(<CorrigirEtapa ordemId={OS} etapaAtual="qualidade" />)
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir etapa' }))
    fireEvent.change(screen.getByLabelText('Nova etapa'), { target: { value: 'disponivel' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar correção' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Escreva o motivo da correção (3 a 500 caracteres).'))
  })
})
