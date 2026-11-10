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
  { usuarioId: 'u1', nome: 'Diogo', email: 'd@x', telegram: true, discord: false, emailOk: true },
]

function montar(regra: RegraAlerta | null = null) {
  render(
    <RegraForm
      modulo="shopfloor"
      tipo="ficha"
      regra={regra}
      postos={POSTOS}
      pmosDisponiveis={['PMOA', 'PMOB']}
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
  it('a ficha de apontamento está oculta: nem o ShopFloor nem o Recebimento oferecem o cartão', () => {
    const { unmount } = render(<TipoEscolha modulo="shopfloor" onEscolher={vi.fn()} />)
    expect(screen.queryByText('Ficha de apontamento (Almoxarifado)')).not.toBeInTheDocument()
    // Os outros tipos do ShopFloor continuam lá.
    expect(screen.getByText('Problemas no envio ao Compels')).toBeInTheDocument()
    expect(screen.getByText('Parado ou travado na produção')).toBeInTheDocument()
    unmount()
    render(<TipoEscolha modulo="recebimento" onEscolher={vi.fn()} />)
    expect(screen.queryByText('Ficha de apontamento (Almoxarifado)')).not.toBeInTheDocument()
  })
})

describe('formulário da regra ficha', () => {
  it('sem posto, sem janela, sem lembrete e sem prévia; com PMOs, responsáveis e canais; explica o gatilho', () => {
    montar()
    expect(screen.queryByText('Postos')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Almoxarifado')).not.toBeInTheDocument()
    expect(screen.queryByText('Janela')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Limite (dias)')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Adicionar intervalo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ver prévia/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Diogo')).toBeInTheDocument()
    expect(screen.getByLabelText('Telegram')).toBeInTheDocument()
    expect(screen.getByText(/QR do código/)).toBeInTheDocument()
    expect(screen.getByText(/uma vez só/)).toBeInTheDocument()
    // o filtro de PMOs existe (diferente do fim de EMB)
    expect(screen.getByText('PMOA')).toBeInTheDocument()
  })

  it('manda postos vazios, a janela de fachada, o filtro de PMO e nenhum campo de outro tipo', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Ficha do Almoxarifado' } })
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Diogo'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    const d = enviado()
    expect(d.tipo).toBe('ficha')
    expect(d.postos).toEqual([])
    expect(d.janelaTipo).toBe('op')
    expect(d.janelaValor).toBeNull()
    expect(d.lembreteMin).toBe('')
    expect(d.taxaMinima).toBe('')
    expect(d.minimoBipes).toBe('')
    expect(d.limiteHoras).toBeUndefined()
    expect(d.destinatarios).toEqual(['u1'])
  })

  it('editar abre sem lembrete e com os dados salvos', () => {
    montar({
      id: 'r1', atualizadoEm: '2026-11-06T12:00:00Z', modulo: 'shopfloor', tipo: 'ficha',
      nome: 'Ficha', postos: [], taxaMinima: null, janelaTipo: 'op', janelaValor: null,
      minimoBipes: null, limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null,
      lembreteMin: null, intervalos: [], horaResumo: null, limiteHoras: null, soOpsAtivas: true, incluirManutencao: true,
      canais: ['telegram'], destinatarios: ['u1'], avisarPessoas: true, avisarCanal: true, pmos: ['PMOA'], ativa: true,
    })
    expect(screen.getByLabelText('Nome')).toHaveValue('Ficha')
    expect(screen.queryByLabelText('Lembrar a cada (min)')).not.toBeInTheDocument()
  })
})
