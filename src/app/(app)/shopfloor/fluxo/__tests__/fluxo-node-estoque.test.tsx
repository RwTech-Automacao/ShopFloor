import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { EstoqueCompels } from '@/modules/shopfloor/domain/estoque-compels'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

const { lerEstoqueCompelsAction, lerPendenteCompelsAction } = vi.hoisted(() => ({
  lerEstoqueCompelsAction: vi.fn(),
  lerPendenteCompelsAction: vi.fn(),
}))
// A fonte de dados do Fluxo (fonte-fluxo) importa TODAS as actions; aqui só o estoque importa.
vi.mock('@/modules/shopfloor/application/fluxo-actions', () => ({
  carregarFluxo: vi.fn(), fluxoPeriodo: vi.fn(), rotaSn: vi.fn(), detalhePosto: vi.fn(), historicoPosto: vi.fn(),
  producaoPeriodo: vi.fn(), burninDetalhe: vi.fn(), embalagemCaixas: vi.fn(), snsManutencao: vi.fn(), opsComBipes: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/pesquisa-actions', () => ({
  buscarHistoricoSN: vi.fn(), carregarDefeitosDaOp: vi.fn(), carregarResumoDefeitos: vi.fn(),
}))
vi.mock('@/modules/shopfloor/application/dashboard-actions', () => ({ carregarDashboard: vi.fn() }))
vi.mock('@/modules/shopfloor/application/estoque-compels-actions', () => ({ lerEstoqueCompelsAction, lerPendenteCompelsAction }))

const { FluxoNode } = await import('../fluxo-node')

const OK: EstoqueCompels = {
  tipo: 'ok', disponivel: 1173, porEstoque: [{ estoque: 'PA', saldo: 1000 }, { estoque: 'EINTER', saldo: 173 }], consultadoEm: '2026-11-11T12:00:00.000Z',
}

const saida = (over: Record<string, unknown> = {}) => ({
  posto: 'Saída', wip: 450, registros: 0, aprovadas: 0, reprovadas: 0, retestes: 0, aprovadosPrimeira: 0,
  reprovadosSemReteste: 0, temStatus: false, ehManutencao: false, recurso: 'saida', concluido: false, ehSaida: true,
  passou: 0, devemPassar: null, selecionado: false, ...over,
})

/** Linha do resumo pelo rótulo → o texto do número à direita. */
const valorDe = (rotulo: string) => screen.getByText(rotulo).closest('div')!.lastElementChild!.textContent

beforeEach(() => {
  lerEstoqueCompelsAction.mockReset()
  lerPendenteCompelsAction.mockReset()
  lerPendenteCompelsAction.mockResolvedValue(null)
})

describe('card Finalizadas com o Almoxarifado no fim da rota', () => {
  it('título, PMO - OP, contagem e o resumo: total = estoque + aguardando + fila', async () => {
    lerEstoqueCompelsAction.mockResolvedValue(OK)
    lerPendenteCompelsAction.mockResolvedValue({ pecas: 14, situacao: 'esperando_erp', rotulo: 'Esperando o Compels', motivo: 'sem empenho', oQueFazer: 'Nada.' })
    const { container } = render(createElement(FluxoNode, { data: saida({ pmo: 'PMOE74', op: '8665', aguardandoAlmoxarifado: 20 }) } as never))

    expect(container.textContent).toContain('Finalizadas')
    expect(container.textContent).toContain('PMOE74 - 8665')
    expect(container.textContent).toContain('450')
    await waitFor(() => expect(valorDe('Fila Compels')).toBe('14'))
    expect(valorDe('Em estoque')).toBe('1.173')
    expect(valorDe('Aguard. Almoxarifado')).toBe('20')
    expect(valorDe('Total disponível')).toBe('1.207')
    expect(screen.getByLabelText('atenção')).toBeInTheDocument()
    expect(lerEstoqueCompelsAction).toHaveBeenCalledWith('PMOE74')
    expect(lerPendenteCompelsAction).toHaveBeenCalledWith('PMOE74', '8665')
  })

  it('fila vazia com peça aguardando: a linha Fila Compels não aparece', async () => {
    lerEstoqueCompelsAction.mockResolvedValue(OK)
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMO-B', op: '1', aguardandoAlmoxarifado: 3 }) } as never))
    await waitFor(() => expect(valorDe('Total disponível')).toBe('1.176'))
    await waitFor(() => expect(lerPendenteCompelsAction).toHaveBeenCalled())
    expect(valorDe('Aguard. Almoxarifado')).toBe('3')
    expect(screen.queryByText('Fila Compels')).toBeNull()
    expect(screen.queryByLabelText('atenção')).toBeNull()
  })

  it('aguardando e fila zerados: só o Total disponível (= estoque)', async () => {
    lerEstoqueCompelsAction.mockResolvedValue(OK)
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMO-Z', op: '1', aguardandoAlmoxarifado: 0 }) } as never))
    await waitFor(() => expect(valorDe('Total disponível')).toBe('1.173'))
    await waitFor(() => expect(lerPendenteCompelsAction).toHaveBeenCalled())
    expect(screen.queryByText('Em estoque')).toBeNull()
    expect(screen.queryByText('Aguard. Almoxarifado')).toBeNull()
    expect(screen.queryByText('Fila Compels')).toBeNull()
  })

  it('Compels indisponível: estoque diz "indisponível" e o total não inventa número', async () => {
    lerEstoqueCompelsAction.mockResolvedValue({ tipo: 'indisponivel' })
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMO-C', op: '1', aguardandoAlmoxarifado: 5 }) } as never))
    await waitFor(() => expect(valorDe('Em estoque')).toBe('indisponível'))
    expect(valorDe('Total disponível')).toBe('indisponível')
    expect(valorDe('Aguard. Almoxarifado')).toBe('5')
  })
})

describe('card Finalizadas com venda em NF sem baixa', () => {
  it('o vendido em NF sai do total e aparece numa linha própria', async () => {
    lerEstoqueCompelsAction.mockResolvedValue({ ...OK, vendidoEmNf: 73 })
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMONF1', op: '9001', aguardandoAlmoxarifado: 20 }) } as never))
    await waitFor(() => expect(valorDe('Vendido em NF')).toBe('−73'))
    expect(valorDe('Total disponível')).toBe('1.120') // 1.173 + 20 − 73
  })

  it('OP sem Almoxarifado: total = estoque − vendido, sem a linha de aguardando', async () => {
    lerEstoqueCompelsAction.mockResolvedValue({ ...OK, vendidoEmNf: 173 })
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMONF2', op: '9002' }) } as never))
    await waitFor(() => expect(valorDe('Total disponível')).toBe('1.000'))
    expect(screen.queryByText('Aguard. Almoxarifado')).toBeNull()
  })
})

describe('card Finalizadas sem o Almoxarifado na rota', () => {
  it('só o Total disponível (estoque do Compels); não consulta a fila', async () => {
    lerEstoqueCompelsAction.mockResolvedValue(OK)
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMOE74', op: '8665' }) } as never))
    await waitFor(() => expect(valorDe('Total disponível')).toBe('1.173'))
    expect(screen.queryByText('Em estoque')).toBeNull()
    expect(screen.queryByText('Aguard. Almoxarifado')).toBeNull()
    expect(screen.queryByText('Fila Compels')).toBeNull()
    expect(lerPendenteCompelsAction).not.toHaveBeenCalled()
  })

  it('sem PMO (nenhuma OP escolhida): sem resumo e sem consulta; outro posto nunca consulta', () => {
    render(createElement(FluxoNode, { data: saida() } as never))
    render(createElement(FluxoNode, { data: { ...saida({ pmo: 'PMO-D' }), ehSaida: false, recurso: 'caixa', posto: 'Embalagem' } } as never))
    expect(lerEstoqueCompelsAction).not.toHaveBeenCalled()
    expect(screen.queryByText('Total disponível')).toBeNull()
  })

  it('enquanto consulta mostra "…"; a chamada que lança vira "indisponível"', async () => {
    lerEstoqueCompelsAction.mockRejectedValue(new Error('rede'))
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMO-E' }) } as never))
    expect(valorDe('Total disponível')).toBe('…')
    await waitFor(() => expect(valorDe('Total disponível')).toBe('indisponível'))
  })
})
