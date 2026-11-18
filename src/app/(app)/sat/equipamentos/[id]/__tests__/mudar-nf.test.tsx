import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { corrigirNfAction } from '@/modules/sat/application/actions'
import type { MotivoNf } from '@/modules/sat/infra/repository'
import { MudarNf } from '../mudar-nf'

vi.mock('server-only', () => ({}))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/sat/application/actions', () => ({
  corrigirNfAction: vi.fn(async () => ({ ok: true, valor: null })),
  trocarNfAction: vi.fn(async () => ({ ok: true, valor: null })),
  buscarEmpresaAction: vi.fn(async () => ({ ok: true, valor: null })),
}))

const NF = '00000000-0000-0000-0000-000000000001'
const MOTIVOS: MotivoNf[] = [
  { id: '00000000-0000-0000-0000-0000000000a2', texto: 'CFOP errado', ativo: true, ordem: 2, exigeTexto: false },
  { id: '00000000-0000-0000-0000-0000000000a6', texto: 'Outro', ativo: true, ordem: 6, exigeTexto: true },
]

beforeEach(() => vi.clearAllMocks())

describe('MudarNf — Corrigir NF', () => {
  it('abre com os motivos da nota: "Outro: xyz" volta marcado e com o texto no "Qual?"', async () => {
    render(
      <MudarNf nfId={NF} nfAtual="4521" situacaoAtual="reprovada" motivosAtuais={['CFOP errado', 'Outro: falta o pedido']}
        relogios={1} motivos={MOTIVOS} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Corrigir NF 4521' }))
    expect(screen.getByRole('checkbox', { name: 'CFOP errado' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Outro' })).toBeChecked()
    expect(screen.getByLabelText(/Qual\?/)).toHaveValue('falta o pedido')

    fireEvent.change(screen.getByLabelText(/Qual\?/), { target: { value: 'outro texto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }))
    await waitFor(() => expect(corrigirNfAction).toHaveBeenCalledWith(
      NF, 'reprovada', [MOTIVOS[0]!.id, MOTIVOS[1]!.id], 'outro texto'))
  })
})
