import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PostoRegra } from '@/modules/alertas/domain/postos-regra'
import type { DestinatarioDisponivel, RegraAlerta } from '@/modules/alertas/domain/regra'
import type { TipoRegra } from '@/modules/alertas/domain/tipos'
import { RegraForm } from '../regra-form'

const salvarRegraAction = vi.fn()

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: (...a: unknown[]) => salvarRegraAction(...a),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const POSTOS: PostoRegra[] = [
  { chave: 'Teste', temStatus: true, coletaDefeito: true, almoxarifado: false },
  { chave: 'Almoxarifado', temStatus: false, coletaDefeito: false, almoxarifado: true },
]
// A lista que a tela recebe é a do 'compels' (0182): administradores + quem só usa o Almoxarifado.
const DESTINATARIOS: DestinatarioDisponivel[] = [
  { usuarioId: 'u1', nome: 'Valdei', email: 'v@x', telegram: true, discord: false, emailOk: true, administra: true },
  { usuarioId: 'g1', nome: 'Gilania', email: 'g@x', telegram: true, discord: false, emailOk: true, administra: false },
]

function montar(tipo: TipoRegra, regra: RegraAlerta | null = null) {
  render(
    <RegraForm
      modulo="shopfloor"
      tipo={tipo}
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

const SALVA: RegraAlerta = {
  id: 'r1', atualizadoEm: '2026-11-06T12:00:00Z', modulo: 'shopfloor', tipo: 'compels',
  nome: 'Compels', postos: ['Almoxarifado'], taxaMinima: null, janelaTipo: 'op', janelaValor: null,
  minimoBipes: null, limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null,
  lembreteMin: 60, intervalos: [], horaResumo: null, limiteHoras: null, soOpsAtivas: true, incluirManutencao: true,
  canais: ['telegram'], destinatarios: ['u1', 'g1'], avisarPessoas: true, avisarCanal: false, pmos: [], ativa: true,
}

beforeEach(() => vi.clearAllMocks())

describe('responsáveis da regra compels (0182)', () => {
  it('a regra compels oferece quem só usa o Almoxarifado, e salva com ela', async () => {
    salvarRegraAction.mockResolvedValue({ ok: true, id: 'g1' })
    montar('compels')
    expect(screen.getByLabelText('Valdei')).toBeInTheDocument()
    expect(screen.getByLabelText('Gilania')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Compels' } })
    fireEvent.click(screen.getByLabelText('Almoxarifado'))
    fireEvent.click(screen.getByLabelText('Telegram'))
    fireEvent.click(screen.getByLabelText('Gilania'))
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(salvarRegraAction).toHaveBeenCalled())
    expect((salvarRegraAction.mock.calls[0] as unknown[])[2]).toMatchObject({ destinatarios: ['g1'] })
  })

  it('editar a regra compels mantém a responsável do Almoxarifado (não a descarta)', () => {
    montar('compels', SALVA)
    expect(screen.getByLabelText('Gilania')).toBeChecked()
    expect(screen.queryByText(/removido\(s\) da regra/)).not.toBeInTheDocument()
  })

  it.each<TipoRegra>(['parado', 'aprovacao', 'tempo', 'defeito'])(
    'a regra %s continua oferecendo só quem administra',
    (tipo) => {
      montar(tipo)
      expect(screen.getByLabelText('Valdei')).toBeInTheDocument()
      expect(screen.queryByLabelText('Gilania')).not.toBeInTheDocument()
    },
  )
})
