import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'

vi.mock('server-only', () => ({}))

const { push, salvar, carregarValores } = vi.hoisted(() => ({
  push: vi.fn(),
  salvar: vi.fn(),
  carregarValores: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }))
vi.mock('@/modules/recebimento/application/justificar-divergencia', () => ({
  salvarJustificativaDivergencia: salvar,
}))
vi.mock('@/modules/recebimento/application/carregar-processos-grid', () => ({
  carregarValoresColuna: carregarValores,
}))

import { ProcessosGrid } from '../processos-grid'
import { decodificarEstadoGrid } from '@/modules/recebimento/domain/estado-grid'
import type { ColunaGrid } from '@/modules/recebimento/infra/processo-repository'

/**
 * Visto em produção em 09/10/2026: com a grade rolada, o selo "?" da divergência aparecia POR CIMA
 * do cabeçalho pregado no topo, em cima da palavra "Divergência".
 *
 * A causa é empilhamento: o cabeçalho é `sticky z-10` e o selo é `relative z-10`. Empatados, vence
 * quem vem depois no DOM — a linha. O `z-10` do selo não pode sair: ele existe para o selo receber
 * o toque por cima do link que cobre o card inteiro no Fluxo do Recebimento.
 *
 * Então o que este teste protege é a RELAÇÃO, não um número: o cabeçalho tem de empilhar acima do
 * selo. Ele morre se alguém baixar o cabeçalho ou subir o selo.
 */

const colunas: ColunaGrid[] = [
  { campo: 'numero', rotulo: 'Número', tipo: 'numero' },
  { campo: 'divergencia', rotulo: 'Divergência', tipo: 'lista' },
]
const estado = decodificarEstadoGrid(undefined, colunas.map((c) => c.campo))

vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })

beforeEach(() => {
  vi.clearAllMocks()
  salvar.mockResolvedValue({ ok: true })
  carregarValores.mockResolvedValue({ ok: true, valores: [] })
})

/** Lê o `z-<n>` de uma lista de classes do Tailwind. Sem z- nenhum => 0 (nível do fluxo normal). */
function nivelZ(classes: string): number {
  const m = classes.match(/(?:^|\s)z-(\d+)(?:\s|$)/)
  return m ? Number(m[1]) : 0
}

describe('o cabeçalho da grade fica acima do selo de divergência', () => {
  it('o cabeçalho pregado empilha acima do selo da linha', () => {
    render(
      <ProcessosGrid
        colunas={colunas}
        total={1}
        estado={estado}
        podeJustificar
        linhas={[{
          id: 'p1', numero: 101, divergencia: -505,
          divergencia_justificativa: '', divergencia_justificada_por_nome: '', divergencia_justificada_em: null,
        }]}
      />,
    )

    const tabela = screen.getByRole('table')
    const cabecalho = tabela.querySelector('thead')!
    const selo = within(tabela).getByRole('button', { name: 'Divergência sem justificativa' })

    // Pré-condição: se um dos dois deixar de empilhar, o teste não estaria medindo nada.
    expect(cabecalho.className).toMatch(/sticky/)
    expect(nivelZ(selo.className)).toBeGreaterThan(0)

    expect(nivelZ(cabecalho.className)).toBeGreaterThan(nivelZ(selo.className))
  })

  it('o selo continua empilhando acima do fluxo normal (é o que o Fluxo do Recebimento precisa)', () => {
    render(
      <ProcessosGrid
        colunas={colunas}
        total={1}
        estado={estado}
        podeJustificar
        linhas={[{
          id: 'p1', numero: 101, divergencia: -505,
          divergencia_justificativa: '', divergencia_justificada_por_nome: '', divergencia_justificada_em: null,
        }]}
      />,
    )
    const selo = within(screen.getByRole('table')).getByRole('button', { name: 'Divergência sem justificativa' })
    expect(nivelZ(selo.className)).toBeGreaterThan(0)
  })
})
