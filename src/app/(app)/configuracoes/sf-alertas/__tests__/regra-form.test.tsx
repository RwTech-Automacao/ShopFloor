import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { RegraForm, separarDestinatarios } from '../regra-form'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))

const toastSucesso = vi.fn()
const toastErro = vi.fn()
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSucesso(...a), error: (...a: unknown[]) => toastErro(...a) },
}))

const POSTOS = ['Teste', 'Embalagem']
const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true },
  { usuarioId: 'u3', nome: 'Carla Operadora', email: 'carla@x', telegram: false, discord: false },
]
const CONFIGURADOS = { telegram: true, discord: true }

function montar(onSalvo = vi.fn()) {
  render(
    <RegraForm
      regra={null}
      postos={POSTOS}
      destinatarios={DESTINATARIOS}
      configurados={CONFIGURADOS}
      onSalvo={onSalvo}
      onCancelar={vi.fn()}
    />,
  )
  return { onSalvo }
}

beforeEach(() => {
  vi.clearAllMocks()
  salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
  previaRegraAction.mockResolvedValue({
    ok: true,
    postos: [{ posto: 'Teste', aprovados: 15, reprovados: 5, taxa: 75, avaliavel: true, pmo: null, op: null }],
  })
})

describe('RegraForm', () => {
  it('começa com os padrões da spec', () => {
    montar()
    expect(screen.getByLabelText('Taxa mínima de aprovação (%)')).toHaveValue('90')
    expect(screen.getByLabelText('Últimos minutos')).toHaveValue('60')
    expect(screen.getByLabelText('Mínimo de bipes')).toHaveValue('20')
  })

  it('salvar sem posto avisa e não chama a action', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Teste 90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalledWith('Escolha pelo menos 1 posto.', { position: 'bottom-center' }))
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('avisa quem não recebe pelo canal escolhido', () => {
    montar()
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Carla Operadora'))
    expect(screen.getByText('Carla Operadora sem Telegram')).toBeInTheDocument()
  })

  it('salva a regra com os valores digitados', async () => {
    const { onSalvo } = montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Teste 90' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.change(screen.getByLabelText('Taxa mínima de aprovação (%)'), { target: { value: '92,5' } })
    fireEvent.change(screen.getByLabelText('Lembrar a cada (min)'), { target: { value: '10' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))

    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction).toHaveBeenCalledWith(null, {
      nome: 'Teste 90',
      postos: ['Teste'],
      taxaMinima: '92,5',
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '20',
      lembreteMin: '10',
      canais: ['telegram'],
      destinatarios: ['u1'],
      ativa: true,
    })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('janela por OP não manda valor de janela', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'OP' } })
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByLabelText('OP em andamento'))
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Ana Gestora'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ janelaTipo: 'op', janelaValor: null })
  })

  it('prévia mostra a taxa de agora de cada posto', async () => {
    montar()
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Ver prévia' }))
    await waitFor(() => expect(previaRegraAction).toHaveBeenCalled())
    expect(await screen.findByText('Teste: 75,0% (15 aprovados, 5 reprovados)')).toBeInTheDocument()
  })

  it('destinatário salvo que ficou inativo sai da regra, com aviso, e o salvar manda só os ativos', async () => {
    const onSalvo = vi.fn()
    render(
      <RegraForm
        regra={{
          id: 'r1',
          atualizadoEm: '2026-09-17T12:00:00Z',
          nome: 'Teste 90',
          postos: ['Teste'],
          taxaMinima: 90,
          janelaTipo: 'tempo',
          janelaValor: 60,
          minimoBipes: 20,
          lembreteMin: null,
          canais: ['telegram'],
          destinatarios: ['u1', 'u-inativo', 'u-removido'],
          ativa: true,
        }}
        postos={POSTOS}
        destinatarios={DESTINATARIOS}
        configurados={CONFIGURADOS}
        onSalvo={onSalvo}
        onCancelar={vi.fn()}
      />,
    )
    expect(
      screen.getByText('2 destinatário(s) inativo(s) removido(s) da regra — salve para confirmar.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Ana Gestora')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(salvarRegraAction.mock.calls[0]![0]).toBe('r1')
    expect(salvarRegraAction.mock.calls[0]![1]).toMatchObject({ destinatarios: ['u1'] })
    await waitFor(() => expect(onSalvo).toHaveBeenCalled())
  })

  it('regra sem destinatário inativo não mostra o aviso', () => {
    montar()
    expect(screen.queryByText(/inativo\(s\) removido/)).not.toBeInTheDocument()
  })
})

describe('separarDestinatarios', () => {
  it('descarta quem não está entre os disponíveis', () => {
    expect(separarDestinatarios(['u1', 'x', 'u3'], DESTINATARIOS)).toEqual({ validos: ['u1', 'u3'], descartados: 1 })
  })

  it('lista de disponíveis vazia (nada carregou) não descarta ninguém', () => {
    expect(separarDestinatarios(['u1', 'x'], [])).toEqual({ validos: ['u1', 'x'], descartados: 0 })
  })
})
