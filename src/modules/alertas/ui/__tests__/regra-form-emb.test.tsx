import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraForm } from '../regra-form'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))
const toastErro = vi.fn()
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: (...a: unknown[]) => toastErro(...a) } }))

const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Beto Recebimento', email: 'beto@x', telegram: true, discord: false, emailOk: true },
]

/**
 * O Recebimento não tem posto nenhum para oferecer (a tela passa `postos={[]}`) e não tem PMO: é
 * assim que a rota `rec-alertas` monta o formulário hoje.
 */
function montar(regra: RegraAlerta | null = null) {
  render(
    <RegraForm
      modulo="recebimento"
      tipo="emb"
      regra={regra}
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

/** O que foi mandado ao servidor na primeira chamada de salvar. */
const enviado = () => (salvarRegraAction.mock.calls[0] as unknown[])[2] as Record<string, unknown>

beforeEach(() => vi.clearAllMocks())

describe('formulário do fim de EMB', () => {
  it('monta: mostra nome, responsáveis e como avisar', () => {
    montar()
    expect(screen.getByLabelText('Nome')).toBeInTheDocument()
    expect(screen.getByText('Responsáveis')).toBeInTheDocument()
    expect(screen.getByText('Como avisar')).toBeInTheDocument()
    expect(screen.getByLabelText('Telegram')).toBeInTheDocument()
    expect(screen.getByLabelText('Beto Recebimento')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar' })).toBeInTheDocument()
  })

  it('oferece o e-mail como canal e o manda ao servidor', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g9' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Fim de EMB' } })
    fireEvent.click(screen.getByLabelText('E-mail'))
    fireEvent.click(screen.getByLabelText('Beto Recebimento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(enviado().canais).toEqual(['email'])
  })

  it('não mostra posto, janela, lembrete, PMO nem prévia', () => {
    montar()
    expect(screen.queryByText('Postos')).not.toBeInTheDocument()
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/lembrar a cada/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/PMOs/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
  })

  it('explica o gatilho na própria tela', () => {
    montar()
    expect(screen.getByText(/todos os processos/i)).toBeInTheDocument()
  })

  // ⚠️ A EMB que fecha SEM divergência também avisa (decisão 5 da spec, revertida em 14/10/2026).
  // A tela tem de dizer isso, senão o gestor acha que a regra só fala quando há problema.
  it('diz que a EMB sem divergência também avisa', () => {
    montar()
    expect(screen.getByText(/também avisa/i)).toBeInTheDocument()
  })

  it('manda ao servidor uma regra sem posto, sem janela e sem PMO', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g9' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Fim de EMB' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Beto Recebimento'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.tipo).toBe('emb')
    expect(d.postos).toEqual([])
    expect(d.pmos).toEqual([])
    expect(d.taxaMinima).toBe('')
    expect(d.minimoBipes).toBe('')
    expect(d.lembreteMin).toBe('')
    expect(d.limiteTempo).toBe('')
    expect(d.limiteOcorrencias).toBe('')
    expect(d.pausaMaxMin).toBe('')
    expect(d.horaResumo).toBeUndefined()
    expect(d.intervalos).toBeUndefined()
    // A janela é a de FACHADA que a validação força ('op' com valor nulo, ver validarRegra): o
    // formulário manda a mesma, e não os minutos de um campo que ele não mostra.
    expect(d.janelaTipo).toBe('op')
    expect(d.janelaValor).toBeNull()
    // O módulo vai como 1º parâmetro da action.
    expect((salvarRegraAction.mock.calls[0] as unknown[])[0]).toBe('recebimento')
  })

  it('cobra responsável, como qualquer regra', async () => {
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Fim de EMB' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalled())
    expect(String((toastErro.mock.calls[0] as unknown[])[0])).toContain('responsável')
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  // Regra JÁ SALVA reaberta para editar: o que o banco guardou (janela 'op' de fachada, lembrete
  // nulo) não pode voltar como campo preenchido, senão o `naoUsados` do 'emb' recusa a própria
  // regra na hora de salvar de novo.
  it('regra salva reabre e salva de novo sem nada alheio ao tipo', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g9' })
    montar({
      id: 'g9', atualizadoEm: '2026-10-14T12:00:00Z', modulo: 'recebimento', tipo: 'emb',
      nome: 'Divergências de EMB', postos: [], taxaMinima: null, janelaTipo: 'op', janelaValor: null,
      minimoBipes: null, limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null,
      lembreteMin: null, intervalos: [], horaResumo: null, canais: ['telegram'],
      destinatarios: ['u1'], avisarPessoas: true, avisarCanal: false, pmos: [], ativa: true,
    })
    expect(screen.getByLabelText('Nome')).toHaveValue('Divergências de EMB')
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.janelaTipo).toBe('op')
    expect(d.janelaValor).toBeNull()
    expect(d.minimoBipes).toBe('')
    expect(d.lembreteMin).toBe('')
  })
})
