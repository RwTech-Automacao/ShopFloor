import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RegraForm } from '../regra-form'

const salvarRegraAction = vi.fn()
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Dora SAT', email: 'dora@x', telegram: true, discord: false, emailOk: true },
]

/** Como a rota /sat/alertas monta o formulário: sem postos e sem PMOs. */
function montar() {
  render(
    <RegraForm
      modulo="sat"
      tipo="sat_entrada"
      regra={null}
      postos={[]}
      pmosDisponiveis={[]}
      destinatarios={DESTINATARIOS}
      configurados={{ telegram: true, discord: true, email: true }}
      canalConfigurado
      onSalvo={vi.fn()}
      onCancelar={vi.fn()}
    />,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('formulário da entrada no SAT', () => {
  it('não mostra posto, janela, lembrete, PMO nem prévia; explica o gatilho', () => {
    montar()
    expect(screen.queryByText('Postos')).not.toBeInTheDocument()
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/lembrar a cada/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PMOs/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
    expect(screen.getByText(/NF registrada/)).toBeInTheDocument()
  })

  it('salva no módulo sat, sem posto, PMO, janela nem lembrete', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Entrada no SAT' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Dora SAT'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const [modulo, id, dados] = salvarRegraAction.mock.calls[0] as [string, string | null, Record<string, unknown>]
    expect(modulo).toBe('sat')
    expect(id).toBeNull()
    expect(dados).toMatchObject({ tipo: 'sat_entrada', postos: [], pmos: [], janelaTipo: 'op', lembreteMin: '' })
  })
})
