import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { RegraAlerta } from '@/modules/alertas/domain/regra'
import { RegrasLista } from '../regras-lista'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/modules/alertas/application/alertas-actions', () => ({
  alternarRegraAtivaAction: vi.fn(),
  excluirRegraAction: vi.fn(),
  salvarRegraAction: vi.fn(),
  previaRegraAction: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const BASE: RegraAlerta = {
  id: 'r1',
  atualizadoEm: '2026-09-18T12:00:00Z',
  tipo: 'tempo',
  nome: 'Teste lento',
  postos: ['Teste'],
  taxaMinima: null,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 10,
  limiteTempoSeg: 120,
  limiteOcorrencias: null,
  pausaMaxMin: 30,
  lembreteMin: null,
  intervalos: [],
  canais: ['telegram'],
  avisarPessoas: true,
  avisarCanal: false,
  destinatarios: ['u1'],
  pmos: ['PMOX', 'PMOY'],
  ativa: true,
}

describe('RegrasLista', () => {
  it('mostra o tipo, o limite formatado por tipo e as PMOs', () => {
    render(
      <RegrasLista
        regras={[
          BASE,
          {
            ...BASE,
            id: 'r2',
            tipo: 'defeito',
            nome: 'Defeito 5x',
            minimoBipes: null,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            limiteOcorrencias: 5,
            pmos: [],
          },
        ]}
        postos={[{ chave: 'Teste', temStatus: true, coletaDefeito: true }]}
        pmos={['PMOX']}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false }]}
        configurados={{ telegram: true, discord: true }}
        canalConfigurado
      />,
    )
    expect(screen.getAllByText('Tipo').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tempo médio por peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Defeito repetido').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≤ 2:00/peça').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≥ 5 vezes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('PMOX, PMOY').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Todas').length).toBeGreaterThan(0)
  })

  it('regra de janela "intervalos": a coluna Janela mostra "Blocos de 1 h" e o limite sai como taxa', () => {
    render(
      <RegrasLista
        regras={[
          {
            ...BASE,
            id: 'r3',
            tipo: 'aprovacao',
            nome: 'Taxa por bloco',
            taxaMinima: 95,
            janelaTipo: 'intervalos',
            janelaValor: 60,
            limiteTempoSeg: null,
            pausaMaxMin: null,
            intervalos: [
              { inicio: '07:00', fim: '12:00' },
              { inicio: '13:30', fim: '17:30' },
            ],
          },
        ]}
        postos={[{ chave: 'Teste', temStatus: true, coletaDefeito: true }]}
        pmos={['PMOX']}
        destinatarios={[{ usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: false }]}
        configurados={{ telegram: true, discord: true }}
        canalConfigurado
      />,
    )
    expect(screen.getAllByText('Blocos de 1 h').length).toBeGreaterThan(0)
    expect(screen.getAllByText('≥ 95%').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Últimos/)).toBeNull()
  })
})
