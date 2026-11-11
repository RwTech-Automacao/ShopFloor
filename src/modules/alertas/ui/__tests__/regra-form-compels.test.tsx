import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PostoRegra } from '@/modules/alertas/domain/postos-regra'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraForm } from '../regra-form'
import { TipoEscolha } from '../tipo-escolha'

const salvarRegraAction = vi.fn()
const previaRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: (...a: unknown[]) => previaRegraAction(...a),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const POSTOS: PostoRegra[] = [
  { chave: 'Teste', temStatus: true, coletaDefeito: true, almoxarifado: false },
  { chave: 'Almoxarifado', temStatus: false, coletaDefeito: false, almoxarifado: true },
]
const DESTINATARIOS = [
  { usuarioId: 'u1', nome: 'Valdei', email: 'v@x', telegram: true, discord: false, emailOk: true },
]

function montar(regra: RegraAlerta | null = null) {
  render(
    <RegraForm
      modulo="shopfloor"
      tipo="compels"
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

beforeEach(() => vi.clearAllMocks())

describe('escolha do tipo', () => {
  it('o ShopFloor oferece o cartão de problemas no envio ao Compels', () => {
    render(<TipoEscolha modulo="shopfloor" onEscolher={vi.fn()} />)
    expect(screen.getByText('Problemas no envio ao Compels')).toBeInTheDocument()
  })
  it('o Recebimento não', () => {
    render(<TipoEscolha modulo="recebimento" onEscolher={vi.fn()} />)
    expect(screen.queryByText('Problemas no envio ao Compels')).not.toBeInTheDocument()
  })
})

describe('formulário da regra compels', () => {
  it('lista só o posto Almoxarifado, mostra lembrete (vazio) e PMOs, e esconde o que não se aplica', () => {
    montar()
    expect(screen.getByLabelText('Almoxarifado')).toBeInTheDocument()
    expect(screen.queryByLabelText('Teste')).not.toBeInTheDocument()
    // O padrão do compels (60 min) não é uma das opções fixas: abre em Personalizado, com os minutos.
    expect(screen.getByLabelText('Lembrar a cada')).toHaveValue('personalizado')
    expect(screen.getByLabelText('Lembrar a cada (min)')).toHaveValue('60')
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Limite (dias)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adicionar intervalo' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Taxa mínima de aprovação (%)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
    expect(screen.getByText(/primeira falha/i)).toBeInTheDocument()
  })

  it('manda a janela de fachada, o lembrete escolhido e nenhum campo de outro tipo', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Compels Valdei' } })
    fireEvent.click(screen.getByLabelText('Almoxarifado'))
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Valdei'))
    fireEvent.change(screen.getByLabelText('Lembrar a cada (min)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.tipo).toBe('compels')
    expect(d.postos).toEqual(['Almoxarifado'])
    expect(d.janelaTipo).toBe('op')
    expect(d.janelaValor).toBeNull()
    expect(d.lembreteMin).toBe('30')
    expect(d.taxaMinima).toBe('')
    expect(d.minimoBipes).toBe('')
    expect(d.limiteHoras).toBeUndefined()
  })

  it('editar abre com o lembrete salvo', () => {
    montar({
      id: 'r1', atualizadoEm: '2026-11-06T12:00:00Z', modulo: 'shopfloor', tipo: 'compels',
      nome: 'Compels', postos: ['Almoxarifado'], taxaMinima: null, janelaTipo: 'op', janelaValor: null,
      minimoBipes: null, limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null,
      lembreteMin: 90, intervalos: [], horaResumo: null, limiteHoras: null, soOpsAtivas: true, incluirManutencao: true, canais: ['telegram'],
      destinatarios: ['u1'], avisarPessoas: true, avisarCanal: false, pmos: [], ativa: true,
    })
    expect(screen.getByLabelText('Lembrar a cada (min)')).toHaveValue('90')
  })

  it('o lembrete oferece 1 vez por dia e 1 vez por semana, como nos outros tipos', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Compels' } })
    fireEvent.click(screen.getByLabelText('Almoxarifado'))
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Valdei'))
    fireEvent.change(screen.getByLabelText('Lembrar a cada'), { target: { value: 'dia' } })
    expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect(enviado().lembreteMin).toBe('1440')
  })
})
