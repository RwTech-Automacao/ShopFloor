import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegraConteudo } from '../regra-dialog'

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const PROPS = {
  modulo: 'shopfloor' as const,
  postos: [
    { chave: 'Teste', temStatus: true, coletaDefeito: true },
    { chave: 'Embalagem', temStatus: false, coletaDefeito: false },
  ],
  pmos: ['PMOA'],
  destinatarios: [],
  configurados: { telegram: true, discord: true, email: true },
  canalConfigurado: true,
  onFechar: vi.fn(),
}

describe('RegraConteudo', () => {
  it('regra nova: 3 cartões; escolher abre o formulário do tipo; "Trocar tipo" volta', () => {
    render(<RegraConteudo regra={null} {...PROPS} />)
    expect(screen.getByRole('button', { name: /Taxa de aprovação/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Defeito repetido/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Tempo médio por peça/ }))
    expect(screen.getByLabelText('Tempo máximo por peça (mm:ss)')).toBeInTheDocument()
    expect(screen.getByText('Tempo médio por peça')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }))
    expect(screen.getByRole('button', { name: /Defeito repetido/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('Tempo máximo por peça (mm:ss)')).not.toBeInTheDocument()
  })

  it('editar abre direto o formulário do tipo da regra, sem cartões nem "Trocar tipo"', () => {
    const regra: RegraAlerta = {
      id: 'r1',
      atualizadoEm: '2026-09-18T12:00:00Z',
      modulo: 'shopfloor',
      tipo: 'defeito',
      nome: 'Defeito 3x',
      postos: ['Teste'],
      taxaMinima: null,
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: null,
      limiteTempoSeg: null,
      limiteOcorrencias: 3,
      pausaMaxMin: null,
      lembreteMin: null,
      intervalos: [],
      horaResumo: null,
      limiteHoras: null,
      soOpsAtivas: true,
      incluirManutencao: true,
      canais: ['telegram'],
      avisarPessoas: true,
    avisarCanal: false,
    destinatarios: ['u1'],
      pmos: [],
      ativa: true,
    }
    render(<RegraConteudo regra={regra} {...PROPS} />)
    expect(screen.getByLabelText('Repetições para alertar')).toHaveValue('3')
    expect(screen.queryByRole('button', { name: /Taxa de aprovação/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Trocar tipo' })).not.toBeInTheDocument()
  })

  it('trocar o tipo com posto marcado começa de novo: o formulário novo abre sem posto marcado', () => {
    render(<RegraConteudo regra={null} {...PROPS} />)
    // Tempo médio aceita a Embalagem; a taxa de aprovação, não.
    fireEvent.click(screen.getByRole('button', { name: /Tempo médio por peça/ }))
    fireEvent.click(screen.getByLabelText('Embalagem'))
    fireEvent.click(screen.getByLabelText('Teste'))
    fireEvent.click(screen.getByRole('button', { name: 'Trocar tipo' }))
    fireEvent.click(screen.getByRole('button', { name: /Taxa de aprovação/ }))
    expect(screen.queryByLabelText('Embalagem')).not.toBeInTheDocument()
    // Nada sobra da escolha anterior: o formulário é montado de novo, sem aviso de posto herdado.
    expect(screen.getByLabelText('Teste')).not.toBeChecked()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('a ficha de apontamento não tem cartão na regra nova, mas a regra de ficha que já existe abre para editar', () => {
    const { unmount } = render(<RegraConteudo regra={null} {...PROPS} />)
    expect(screen.queryByRole('button', { name: /Ficha de apontamento/ })).not.toBeInTheDocument()
    unmount()
    const regra: RegraAlerta = {
      id: 'f1', atualizadoEm: '2026-11-06T12:00:00Z', modulo: 'shopfloor', tipo: 'ficha',
      nome: 'Ficha antiga', postos: [], taxaMinima: null, janelaTipo: 'op', janelaValor: null,
      minimoBipes: null, limiteTempoSeg: null, limiteOcorrencias: null, pausaMaxMin: null,
      lembreteMin: null, intervalos: [], horaResumo: null, limiteHoras: null, soOpsAtivas: true,
      incluirManutencao: true, canais: ['telegram'], destinatarios: [], avisarPessoas: true,
      avisarCanal: false, pmos: [], ativa: true,
    }
    render(<RegraConteudo regra={regra} {...PROPS} />)
    expect(screen.getByText('Ficha de apontamento (Almoxarifado)')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).toHaveValue('Ficha antiga')
  })
})
