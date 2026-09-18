import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CartaoAlertas } from '../cartao-alertas'

const gerarCodigoAction = vi.fn()
const minhasContasAction = vi.fn()
const desvincularAction = vi.fn()
const enviarTesteAction = vi.fn()

vi.mock('@/modules/alertas/application/perfil-alertas-actions', () => ({
  gerarCodigoAction: (...a: unknown[]) => gerarCodigoAction(...a),
  minhasContasAction: (...a: unknown[]) => minhasContasAction(...a),
  desvincularAction: (...a: unknown[]) => desvincularAction(...a),
  enviarTesteAction: (...a: unknown[]) => enviarTesteAction(...a),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) } }))

beforeEach(() => {
  vi.clearAllMocks()
  minhasContasAction.mockResolvedValue({ ok: true, contas: [] })
  gerarCodigoAction.mockResolvedValue({
    ok: true,
    codigo: 'ALERTA-7K3M',
    expiraEm: new Date(Date.now() + 15 * 60_000).toISOString(),
  })
  enviarTesteAction.mockResolvedValue({ ok: true })
})

const TODOS_CONFIGURADOS = { telegram: true, discord: true }

describe('CartaoAlertas', () => {
  it('canal sem token aparece como não configurado', () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[]}
        configurados={{ telegram: true, discord: false }}
        telegramBot="shopfloor_bot"
      />,
    )
    expect(screen.getByText('Não configurado neste ambiente')).toBeInTheDocument()
    const botoes = screen.getAllByRole('button', { name: 'Vincular' })
    expect(botoes).toHaveLength(2) // Telegram e Discord
    expect(botoes[1]).toBeDisabled() // Discord sem token
  })

  it('canal vinculado mostra a data e as ações', () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[{ canal: 'telegram', vinculadoEm: '2026-09-16T12:00:00Z' }]}
        configurados={TODOS_CONFIGURADOS}
        telegramBot="shopfloor_bot"
      />,
    )
    expect(screen.getByText('Vinculado em 16/09')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar teste' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desvincular' })).toBeInTheDocument()
  })

  it('Vincular mostra o código e a instrução do bot', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.getByText(/t\.me\/shopfloor_bot/)).toBeInTheDocument()
  })

  it('Vincular no Discord instrui o comando /vincular', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[1]!)
    expect(await screen.findByText(/\/vincular ALERTA-7K3M/)).toBeInTheDocument()
  })

  it('Enviar teste avisa sucesso', async () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[{ canal: 'telegram', vinculadoEm: '2026-09-16T12:00:00Z' }]}
        configurados={TODOS_CONFIGURADOS}
        telegramBot="shopfloor_bot"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Enviar teste' }))
    await waitFor(() => expect(enviarTesteAction).toHaveBeenCalledWith('telegram'))
    await waitFor(() => expect(toastSucesso).toHaveBeenCalled())
  })

  it('erro ao gerar o código vira toast de erro', async () => {
    gerarCodigoAction.mockResolvedValueOnce({ ok: false, erro: 'Sessão inválida. Entre de novo no sistema.' })
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Sessão inválida. Entre de novo no sistema.', {
      position: 'bottom-center',
    }))
  })
  it('para de consultar o servidor quando o código vence', async () => {
    // Relógio falso desde o início: os intervalos do cartão nascem nele.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      gerarCodigoAction.mockResolvedValue({
        ok: true,
        codigo: 'ALERTA-7K3M',
        expiraEm: new Date(Date.now() + 5_000).toISOString(),
      })
      render(<CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="ShopFloorBot" />)
      fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
      await screen.findByText('ALERTA-7K3M')
      await vi.advanceTimersByTimeAsync(10_000) // passa do vencimento (5 s)
      const chamadasAoVencer = minhasContasAction.mock.calls.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(minhasContasAction.mock.calls.length).toBe(chamadasAoVencer)
    } finally {
      vi.useRealTimers()
    }
  })
})
