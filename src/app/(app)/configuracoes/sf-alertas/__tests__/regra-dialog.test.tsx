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
  postos: ['Teste'],
  pmos: ['PMOA'],
  destinatarios: [],
  configurados: { telegram: true, discord: true },
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
})
