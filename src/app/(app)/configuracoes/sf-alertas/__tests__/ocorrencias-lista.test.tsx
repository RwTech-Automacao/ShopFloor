import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { OcorrenciaLinha } from '@/modules/alertas/domain/ocorrencia'
import { OcorrenciasLista } from '../ocorrencias-lista'

vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  listarOcorrenciasAction: vi.fn(),
  resolverOcorrenciaAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE: OcorrenciaLinha = {
  id: 'o1',
  regraId: 'g1',
  regraNome: 'Defeito 3x',
  regraTipo: 'defeito',
  posto: 'Teste',
  defeito: '2040 COMPONENTE FALTANDO',
  pmo: null,
  op: null,
  estado: 'aberta',
  taxaAbertura: null,
  taxaUltima: null,
  valorAbertura: 3,
  valorUltimo: 4,
  amostras: 4,
  aprovados: 0,
  reprovados: 0,
  abertaEm: '2026-09-18T12:00:00Z',
  resolvidaPorNome: '',
  resolvidaEm: null,
  normalizadaEm: null,
  enviosOk: 2,
  enviosFalha: 0,
}

describe('OcorrenciasLista', () => {
  it('mostra o defeito (código + descrição) e o valor medido na régua de cada tipo', () => {
    render(
      <OcorrenciasLista
        ocorrenciasIniciais={[
          BASE,
          { ...BASE, id: 'o2', regraNome: 'Lento', regraTipo: 'tempo', defeito: null, valorAbertura: 180, valorUltimo: 200 },
          {
            ...BASE,
            id: 'o3',
            regraNome: 'Taxa 90',
            regraTipo: 'aprovacao',
            defeito: null,
            taxaAbertura: 75,
            taxaUltima: 88.88,
            valorAbertura: 75,
            valorUltimo: 88.88,
          },
        ]}
        filtroInicial={{ de: '2026-09-12', ate: '2026-09-18', estado: '' }}
      />,
    )
    expect(screen.getByText('Defeito')).toBeInTheDocument()
    expect(screen.getByText('2040 (Componente Faltando)')).toBeInTheDocument()
    expect(screen.getByText('3 vezes')).toBeInTheDocument()
    expect(screen.getByText('4 vezes')).toBeInTheDocument()
    expect(screen.getByText('3:00/peça')).toBeInTheDocument()
    expect(screen.getByText('3:20/peça')).toBeInTheDocument()
    expect(screen.getByText('75,0%')).toBeInTheDocument()
    expect(screen.getByText('88,8%')).toBeInTheDocument()
  })
})
