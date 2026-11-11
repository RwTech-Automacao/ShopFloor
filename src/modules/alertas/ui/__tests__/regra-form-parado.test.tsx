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
  fireEvent.click(screen.getByLabelText('Teste'))
  fireEvent.click(screen.getByLabelText('Telegram'))
  fireEvent.click(screen.getByLabelText('Ana Gestora'))
}

beforeEach(() => vi.clearAllMocks())

describe('formulário da regra parado', () => {
  it('mostra o limite em dias (padrão 1) e o editor de turnos, e esconde o que não se aplica', () => {
    montar()
    expect(screen.getByLabelText('Limite (dias)')).toHaveValue('1')
    expect(screen.queryByLabelText('Limite (horas)')).not.toBeInTheDocument()
    expect(screen.getByText('1 dia = 24 h')).toBeInTheDocument()
    expect(screen.getByLabelText('Só OPs ativas')).toBeChecked()
    expect(screen.getByLabelText('Incluir peças em Manutenção')).toBeChecked()
    expect(screen.getByText(/Turnos \(conta só as horas de expediente; vazio = relógio corrido\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adicionar intervalo' })).toBeInTheDocument()
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Mínimo de bipes')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Ignorar pausas/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
    // Regra nova: sem lembrete, e o campo de minutos só aparece no Personalizado.
    expect(screen.getByLabelText('Lembrar a cada')).toHaveValue('nenhum')
    expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
  })

  it('lista todos os postos da rota (a peça pode parar em qualquer um)', () => {
    montar()
    for (const p of ['Teste', 'Embalagem', 'Almoxarifado']) expect(screen.getByLabelText(p)).toBeInTheDocument()
  })

  it('a dica do limite mostra as horas que vão ser gravadas', () => {
    montar()
    fireEvent.change(screen.getByLabelText('Limite (dias)'), { target: { value: '7' } })
    expect(screen.getByText('7 dias = 168 h')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Limite (dias)'), { target: { value: 'x' } })
    expect(screen.queryByText(/ = \d+ h$/)).not.toBeInTheDocument()
  })

  it('manda as duas opções: o caso de uso de uma semana, relógio corrido, lembrete 1 vez por dia', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    preencher()
    fireEvent.change(screen.getByLabelText('Limite (dias)'), { target: { value: '7' } })
    fireEvent.change(screen.getByLabelText('Lembrar a cada'), { target: { value: 'dia' } })
    fireEvent.click(screen.getByLabelText('Só OPs ativas'))
    fireEvent.click(screen.getByLabelText('Incluir peças em Manutenção'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    // Gravado em horas, como sempre: 7 dias × 24.
    expect(d.limiteHoras).toBe('168')
    expect(d.lembreteMin).toBe('1440')
    expect(d.soOpsAtivas).toBe(false)
    expect(d.incluirManutencao).toBe(false)
    expect(d.intervalos).toEqual([])
  })

  it('lembrete 1 vez por semana manda 10080; Personalizado mostra o campo de minutos e manda o digitado', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    preencher()
    fireEvent.change(screen.getByLabelText('Lembrar a cada'), { target: { value: 'semana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(enviado().lembreteMin).toBe('10080')

    salvarRegraAction.mockClear()
    fireEvent.change(screen.getByLabelText('Lembrar a cada'), { target: { value: 'personalizado' } })
    fireEvent.change(screen.getByLabelText('Lembrar a cada (min)'), { target: { value: '3600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(enviado().lembreteMin).toBe('3600')

    salvarRegraAction.mockClear()
    fireEvent.change(screen.getByLabelText('Lembrar a cada'), { target: { value: 'nenhum' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalledTimes(1))
    expect(enviado().lembreteMin).toBe('')
  })

  it('manda o limite, a janela de fachada e nenhum turno quando o gestor não cadastra', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    preencher()
    fireEvent.change(screen.getByLabelText('Limite (dias)'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.tipo).toBe('parado')
    expect(d.postos).toEqual(['Teste'])
    expect(d.soOpsAtivas).toBe(true)
    expect(d.incluirManutencao).toBe(true)
    expect(d.limiteHoras).toBe('48')
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

  it.each(['0', '31', '1,5', ''])('limite em dias "%s" é recusado na tela, sem ir ao servidor', async (valor) => {
    montar()
    preencher()
    fireEvent.change(screen.getByLabelText('Limite (dias)'), { target: { value: valor } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(toastErro).toHaveBeenCalled())
    expect(String((toastErro.mock.calls[0] as unknown[])[0])).toBe('Informe o limite em dias (de 1 a 30).')
    expect(salvarRegraAction).not.toHaveBeenCalled()
  })

  const SALVA: RegraAlerta = {
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
    limiteHoras: 120,
    soOpsAtivas: false,
    incluirManutencao: false,
    canais: ['telegram'],
    destinatarios: ['u1'],
    avisarPessoas: true,
    avisarCanal: false,
    pmos: [],
    ativa: true,
  }

  it('editar abre com o limite em dias e os turnos salvos, sem aviso de arredondamento', () => {
    montar(SALVA)
    expect(screen.getByLabelText('Limite (dias)')).toHaveValue('5')
    expect(screen.queryByText(/arredondado/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Início do intervalo 1')).toHaveValue('07:00')
    expect(screen.getByLabelText('Só OPs ativas')).not.toBeChecked()
    expect(screen.getByLabelText('Incluir peças em Manutenção')).not.toBeChecked()
  })

  it('limite salvo que não fecha em dias abre arredondado para cima, avisa, e salvar grava os dias inteiros', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'r1' })
    montar({ ...SALVA, limiteHoras: 6 })
    expect(screen.getByLabelText('Limite (dias)')).toHaveValue('1')
    expect(screen.getByText(/O limite salvo é de 6 h/)).toBeInTheDocument()
    expect(screen.getByText(/arredondado para cima/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(enviado().limiteHoras).toBe('24')
  })

  it('lembrete salvo 1440 abre em "1 vez por dia", 10080 em "1 vez por semana" e 3600 em Personalizado', () => {
    for (const [min, modo] of [[1440, 'dia'], [10080, 'semana'], [3600, 'personalizado']] as const) {
      const r = render(
        <RegraForm
          modulo="shopfloor"
          tipo="parado"
          regra={{ ...SALVA, lembreteMin: min }}
          postos={POSTOS}
          pmosDisponiveis={['PMOA']}
          destinatarios={DESTINATARIOS}
          configurados={{ telegram: true, discord: true, email: true }}
          canalConfigurado
          onSalvo={vi.fn()}
          onCancelar={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('Lembrar a cada')).toHaveValue(modo)
      if (modo === 'personalizado') expect(screen.getByLabelText('Lembrar a cada (min)')).toHaveValue('3600')
      else expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
      r.unmount()
    }
  })
})
