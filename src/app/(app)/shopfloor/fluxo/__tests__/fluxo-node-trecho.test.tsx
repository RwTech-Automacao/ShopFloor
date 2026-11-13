import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))
vi.mock('@/modules/shopfloor/application/estoque-compels-actions', () => ({
  lerEstoqueCompelsAction: vi.fn(),
  lerPendenteCompelsAction: vi.fn(),
}))
const trechos = vi.hoisted(() => ({
  lerTrechosCompelsAction: vi.fn(async () => [
    { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 160, naFila: 26, motivo: 'Aguardando requisição no Compels: PRT410' },
  ]),
}))
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => trechos)

const { FluxoNode } = await import('../fluxo-node')
const { limparCacheTrechosParaTeste } = await import('../fluxo-node')

const posto = (id: string, over: Record<string, unknown> = {}) => ({
  posto: id, wip: 3, registros: 0, aprovadas: 0, reprovadas: 0, retestes: 0, aprovadosPrimeira: 0,
  reprovadosSemReteste: 0, temStatus: false, ehManutencao: false, recurso: 'passagem', concluido: false,
  passou: 0, devemPassar: null, selecionado: false, ...over,
})
const renderNo = (id: string, pmo: string, op: string) =>
  render(createElement(FluxoNode, { id, data: posto(id, { pmo, op }) } as never))

beforeEach(() => { limparCacheTrechosParaTeste() })

describe('linha da PRT no card do posto', () => {
  it('o card do posto que conclui um trecho mostra a PRT, a OP filha, apontadas e fila com o motivo', async () => {
    renderNo('Inspeção PTH', 'PMOC14', '8498')
    await waitFor(() => expect(screen.getByText('PRT420 → Compels 8499')).toBeTruthy())
    expect(screen.getByText('apontadas 160 · na fila 26')).toBeTruthy()
    expect(screen.getByLabelText('atenção').closest('[title]')?.getAttribute('title')).toContain('Aguardando requisição no Compels')
  })
  it('posto que não conclui trecho não mostra nada', async () => {
    renderNo('Teste', 'PMOC14', '8498')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/→ Compels/)).toBeNull()
  })
})
