import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PostoRegra } from '@/modules/alertas/domain/postos-regra'
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

const POSTOS: PostoRegra[] = [
  { chave: 'Teste', temStatus: true, coletaDefeito: true, almoxarifado: false },
  { chave: 'Embalagem', temStatus: false, coletaDefeito: false, almoxarifado: false },
  { chave: 'Almoxarifado', temStatus: false, coletaDefeito: false, almoxarifado: true },
]
const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false, emailOk: true },
]

function montar(regra: RegraAlerta | null = null) {
  render(
    <RegraForm
      modulo="shopfloor"
      tipo="parado"
      regra={regra}
      postos={POSTOS}
      pmosDisponiveis={['PMOA']}
      destinatarios={DESTINATARIOS}
      configurados={{ telegram: true, discord: true, email: true }}
      canalConfigurado
      onSalvo={vi.fn()}
      onCancelar={vi.fn()}
    />,
  )
}

const enviado = () => (salvarRegraAction.mock.calls[0] as unknown[])[2] as Record<string, unknown>

function preencher() {
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Parado' } })
  fireEvent.click(screen.getByLabelText('Almoxarifado'))
  fireEvent.click(screen.getByLabelText('Telegram'))
  fireEvent.click(screen.getByLabelText('Ana Gestora'))
}

beforeEach(() => vi.clearAllMocks())

describe('formulário da regra parado', () => {
  it('mostra o limite em horas (padrão 2) e o editor de turnos, e esconde o que não se aplica', () => {
    montar()
    expect(screen.getByLabelText('Limite (horas)')).toHaveValue('2')
    expect(screen.getByText(/Turnos \(conta só as horas de expediente; vazio = relógio corrido\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar intervalo' })).toBeInTheDocument()
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mínimo de bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Ignorar pausas/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
  })

  it('lista só o posto de perfil Almoxarifado', () => {
    montar()
    expect(screen.getByLabelText('Almoxarifado')).toBeInTheDocument()
    expect(screen.queryByLabelText('Teste')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Embalagem')).not.toBeInTheDocument()
  })

  it('manda o limite, a janela de fachada e nenhum turno quando o gestor não cadastra', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    preencher()
    fireEvent.change(screen.getByLabelText('Limite (horas)'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.tipo).toBe('parado')
    expect(d.postos).toEqual(['Almoxarifado'])
    expect(d.limiteHoras).toBe('4')
    expect(d.janelaTipo).toBe('op')
    expect(d.janelaValor).toBeNull()
    expect(d.taxaMinima).toBe('')
    expect(d.minimoBipes).toBe('')
    expect(d.pausaMaxMin).toBe('')
    expect(d.intervalos).toEqual([])
  })

  it('linha de turno deixada em branco não vira erro; turno preenchido vai', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    preencher()
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar intervalo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(enviado().intervalos).toEqual([])

    salvarRegraAction.mockClear()
    fireEvent.change(screen.getByLabelText('Início do intervalo 1'), { target: { value: '07:00' } })
    fireEvent.change(screen.getByLabelText('Fim do intervalo 1'), { target: { value: '12:00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(enviado().intervalos).toEqual([{ inicio: '07:00', fim: '12:00' }])
  })

  it('limite fora de 1 a 72 é recusado na tela, sem ir ao servidor', async () => {
    montar()
    preencher()
    fireEvent.change(screen.getByLabelText('Limite (horas)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalled())
    expect(String((toastErro.mock.calls[0] as unknown[])[0])).toBe('Informe o limite em horas (de 1 a 72).')
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  it('editar abre com o limite e os turnos salvos', () => {
    montar({
      id: 'r1',
      atualizadoEm: '2026-10-29T12:00:00Z',
      modulo: 'shopfloor',
      tipo: 'parado',
      nome: 'Parado',
      postos: ['Almoxarifado'],
      taxaMinima: null,
      janelaTipo: 'op',
      janelaValor: null,
      minimoBipes: null,
      limiteTempoSeg: null,
      limiteOcorrencias: null,
      pausaMaxMin: null,
      lembreteMin: null,
      intervalos: [{ inicio: '07:00', fim: '12:00' }],
      horaResumo: null,
      limiteHoras: 6,
      canais: ['telegram'],
      destinatarios: ['u1'],
      avisarPessoas: true,
      avisarCanal: false,
      pmos: [],
      ativa: true,
    })
    expect(screen.getByLabelText('Limite (horas)')).toHaveValue('6')
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('07:00')
  })
})
