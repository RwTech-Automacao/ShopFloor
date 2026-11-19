import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ResumoTrecho } from '@/modules/shopfloor/infra/estrutura-repository'

vi.mock('server-only', () => ({}))
vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))
vi.mock('@/modules/shopfloor/application/estoque-compels-actions', () => ({
  lerEstoqueCompelsAction: vi.fn(),
  lerPendenteCompelsAction: vi.fn(),
}))
const trechos = vi.hoisted(() => ({
  lerTrechosCompelsAction: vi.fn(async (): Promise<ResumoTrecho[]> => [
    { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 160, naFila: 26, motivo: 'Aguardando requisição no Compels: PRT410' },
  ]),
  lerTrechosDaOpAction: vi.fn(async () => []),
}))
vi.mock('@/modules/shopfloor/application/estrutura-actions', () => trechos)

const { FluxoNode } = await import('../fluxo-node')

const posto = (id: string, over: Record<string, unknown> = {}) => ({
  posto: id, wip: 3, registros: 0, aprovadas: 0, reprovadas: 0, retestes: 0, aprovadosPrimeira: 0,
  reprovadosSemReteste: 0, temStatus: false, ehManutencao: false, recurso: 'passagem', concluido: false,
  passou: 0, devemPassar: null, selecionado: false, ...over,
})
const renderNo = (id: string, pmo: string, op: string) =>
  render(createElement(FluxoNode, { id, data: posto(id, { pmo, op }) } as never))

beforeEach(() => { trechos.lerTrechosCompelsAction.mockClear() })

describe('sem a linha do Compels no card do posto', () => {
  it('o card não mostra PRT → Compels nem apontadas/fila, e não consulta os trechos no Compels', async () => {
    renderNo('Inspeção PTH', 'PMOC14', '8498')
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/→ Compels/)).toBeNull()
    expect(screen.queryByText(/apontadas .* na fila/)).toBeNull()
    expect(trechos.lerTrechosCompelsAction).not.toHaveBeenCalled()
  })
})

describe('linha embaixo do nome do posto', () => {
  it('mostra o trecho do posto no lugar do perfil', () => {
    render(createElement(FluxoNode, { id: 'SPI', data: posto('SPI', { trechoDoPosto: 'PRT410', temStatus: true }) } as never))
    expect(screen.getByText('PRT410')).toBeTruthy()
    expect(screen.queryByText('teste/inspeção')).toBeNull()
  })
  it('OP sem trechos: sem linha de perfil', () => {
    render(createElement(FluxoNode, { id: 'Montagem', data: posto('Montagem') } as never))
    expect(screen.queryByText('passagem')).toBeNull()
    expect(screen.queryByText('teste/inspeção')).toBeNull()
  })
  it('Manutenção continua dizendo "em manutenção"', () => {
    render(createElement(FluxoNode, { id: 'Manutenção', data: posto('Manutenção', { ehManutencao: true, recurso: 'manutencao' }) } as never))
    expect(screen.getByText('em manutenção')).toBeTruthy()
  })
})
