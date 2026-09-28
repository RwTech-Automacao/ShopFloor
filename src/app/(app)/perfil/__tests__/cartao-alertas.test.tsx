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
    const link = screen.getByRole('link', { name: 't.me/shopfloor_bot' })
    expect(link).toHaveAttribute('href', 'https://t.me/shopfloor_bot')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('oferece o Telegram Web para quem não tem o aplicativo no computador', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abra no Telegram Web' })).toHaveAttribute(
      'href',
      'https://web.telegram.org/k/#@shopfloor_bot',
    )
  })

  it('sem o nome do bot a instrução do Telegram não vira link', async () => {
    render(<CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="" />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[0]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.getByText('t.me/seu_bot')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('Vincular no Discord instrui o comando /vincular', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[1]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.getByText('/vincular')).toBeInTheDocument()
    expect(screen.getByText(/Cole o código no campo/)).toBeInTheDocument()
  })

  it('com o convite configurado o Discord ganha o link do servidor do bot', async () => {
    render(
      <CartaoAlertas
        nome="Ana Gestora"
        contas={[]}
        configurados={TODOS_CONFIGURADOS}
        telegramBot="shopfloor_bot"
        discordConvite="https://discord.gg/exemplo"
      />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[1]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar no servidor do Bot ShopFloor' })).toHaveAttribute(
      'href',
      'https://discord.gg/exemplo',
    )
  })

  it('sem o convite o Discord não mostra link nenhum', async () => {
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[1]!)
    expect(await screen.findByText('ALERTA-7K3M')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText(/No servidor do Bot ShopFloor/)).toBeInTheDocument()
  })

  it('Copiar põe só o código na área de transferência', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(
      <CartaoAlertas nome="Ana Gestora" contas={[]} configurados={TODOS_CONFIGURADOS} telegramBot="shopfloor_bot" />,
    )
    fireEvent.click(screen.getAllByRole('button', { name: 'Vincular' })[1]!)
    fireEvent.click(await screen.findByRole('button', { name: 'Copiar' }))
    expect(writeText).toHaveBeenCalledWith('ALERTA-7K3M')
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
