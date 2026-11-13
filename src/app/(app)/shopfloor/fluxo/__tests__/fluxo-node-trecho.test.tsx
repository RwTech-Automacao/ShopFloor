import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ResumoTrecho } from '@/modules/shopfloor/infra/estrutura-repository'

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

beforeEach(() => { limparCacheTrechosParaTeste(); trechos.lerTrechosCompelsAction.mockClear() })

describe('linha da PRT no card do posto', () => {
  it('o card do posto que conclui um trecho mostra a PRT, a OP filha, apontadas e fila com o motivo', async () => {
    renderNo('Inspeção PTH', 'PMOC14', '8498')
    await waitFor(() => expect(screen.getByText('PRT420 → Compels 8499')).toBeTruthy())
    expect(screen.getByText('apontadas 160 · na fila 26')).toBeTruthy()
    expect(screen.getByLabelText('atenção').closest('[title]')?.getAttribute('title')).toContain('Aguardando requisição no Compels')
  })
  it('posto que não conclui trecho não mostra nada', async () => {
    renderNo('Teste', 'PMOC14', '8498')
    await waitFor(() => expect(trechos.lerTrechosCompelsAction).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText(/→ Compels/)).toBeNull()
  })
  it('fila zerada: sem ícone de atenção', async () => {
    trechos.lerTrechosCompelsAction.mockResolvedValueOnce([
      { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 186, naFila: 0, motivo: null },
    ])
    renderNo('Inspeção PTH', 'PMOC14', '8498')
    await waitFor(() => expect(screen.getByText('apontadas 186 · na fila 0')).toBeTruthy())
    expect(screen.queryByLabelText('atenção')).toBeNull()
  })
  it('trecho sem OP no Compels', async () => {
    trechos.lerTrechosCompelsAction.mockResolvedValueOnce([
      { posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: null, apontadas: 0, naFila: 0, motivo: null },
    ])
    renderNo('Inspeção PTH', 'PMOC14', '8498')
    await waitFor(() => expect(screen.getByText('PRT420 → sem OP no Compels')).toBeTruthy())
  })
  it('dois cards da mesma OP dividem uma só consulta', async () => {
    renderNo('Inspeção PTH', 'PMOC14', '8498')
    renderNo('Teste', 'PMOC14', '8498')
    await waitFor(() => expect(screen.getByText('PRT420 → Compels 8499')).toBeTruthy())
    expect(trechos.lerTrechosCompelsAction).toHaveBeenCalledTimes(1)
  })
  it('relê a cada 30 s (não a cada 10 s)', async () => {
    vi.useFakeTimers()
    try {
      renderNo('Inspeção PTH', 'PMOC14', '8498')
      await vi.advanceTimersByTimeAsync(0)
      expect(trechos.lerTrechosCompelsAction).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(10_000)
      expect(trechos.lerTrechosCompelsAction).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(trechos.lerTrechosCompelsAction).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
