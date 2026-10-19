import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { EstoqueCompels } from '@/modules/shopfloor/domain/estoque-compels'

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Left: 'left', Right: 'right' },
}))

const { lerEstoqueCompelsAction } = vi.hoisted(() => ({ lerEstoqueCompelsAction: vi.fn() }))
vi.mock('@/modules/shopfloor/application/estoque-compels-actions', () => ({ lerEstoqueCompelsAction }))

const { FluxoNode, EstoqueCompelsCard } = await import('../fluxo-node')

const OK: EstoqueCompels = {
  tipo: 'ok', proprio: 1234.5, unidade: 'UN', pendencia: 2, emTerceiros: 0, deTerceiros: 3, consultadoEm: '2026-10-19T12:00:00.000Z',
}

const saida = (over: Record<string, unknown> = {}) => ({
  posto: '__SAIDA__', wip: 12, registros: 0, aprovadas: 0, reprovadas: 0, retestes: 0, aprovadosPrimeira: 0,
  reprovadosSemReteste: 0, temStatus: false, ehManutencao: false, recurso: 'saida', concluido: false, ehSaida: true,
  passou: 0, devemPassar: null, selecionado: false, ...over,
})

beforeEach(() => { lerEstoqueCompelsAction.mockReset() })

describe('estoque do Compels abaixo do card Concluído', () => {
  it('mostra o estoque próprio do PMO, formatado em pt-BR, com o detalhe no tooltip', async () => {
    lerEstoqueCompelsAction.mockResolvedValue(OK)
    render(createElement(FluxoNode, { data: saida({ pmo: 'PMO-A' }) } as never))

    expect(await screen.findByText(/1\.234,5 UN/)).toBeInTheDocument()
    expect(screen.getByText(/Estoque no Compels · PMO-A/)).toBeInTheDocument()
    expect(lerEstoqueCompelsAction).toHaveBeenCalledWith('PMO-A')
    const faixa = screen.getByText(/Estoque no Compels · PMO-A/).parentElement!
    expect(faixa.getAttribute('title')).toContain('todos os estoques')
    expect(faixa.getAttribute('title')).toContain('Em pendência: 2')
  })

  it('o card Concluído continua igual (contagem de finalizadas) e a faixa não entra no card de outro posto', async () => {
    lerEstoqueCompelsAction.mockResolvedValue(OK)
    const { container } = render(createElement(FluxoNode, { data: saida({ pmo: 'PMO-B' }) } as never))
    expect(container.textContent).toContain('Concluído')
    expect(container.textContent).toContain('12')

    lerEstoqueCompelsAction.mockClear()
    render(createElement(FluxoNode, { data: { ...saida({ pmo: 'PMO-B' }), ehSaida: false, recurso: 'caixa', posto: 'Embalagem' } } as never))
    expect(lerEstoqueCompelsAction).not.toHaveBeenCalled()
  })

  it('sem PMO no nó (Saída sem OP escolhida) não consulta nada', () => {
    render(createElement(FluxoNode, { data: saida() } as never))
    expect(lerEstoqueCompelsAction).not.toHaveBeenCalled()
  })

  it('integração não configurada neste ambiente: não mostra faixa nenhuma', async () => {
    lerEstoqueCompelsAction.mockResolvedValue({ tipo: 'nao_configurado' })
    render(createElement(EstoqueCompelsCard, { pmo: 'PMO-C' }))
    await waitFor(() => expect(lerEstoqueCompelsAction).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByText(/Estoque no Compels/)).not.toBeInTheDocument())
  })

  it('Compels indisponível: diz "indisponível" (e não um número velho)', async () => {
    lerEstoqueCompelsAction.mockResolvedValue({ tipo: 'indisponivel' })
    render(createElement(EstoqueCompelsCard, { pmo: 'PMO-D' }))
    expect(await screen.findByText('indisponível')).toBeInTheDocument()
  })

  it('a chamada que lança vira "indisponível"', async () => {
    lerEstoqueCompelsAction.mockRejectedValue(new Error('rede'))
    render(createElement(EstoqueCompelsCard, { pmo: 'PMO-E' }))
    expect(await screen.findByText('indisponível')).toBeInTheDocument()
  })

  it('item que o Compels não conhece: "item não encontrado"', async () => {
    lerEstoqueCompelsAction.mockResolvedValue({ tipo: 'nao_encontrado' })
    render(createElement(EstoqueCompelsCard, { pmo: 'PMO-F' }))
    expect(await screen.findByText('item não encontrado')).toBeInTheDocument()
  })

  it('enquanto consulta, mostra "consultando…"; a segunda montagem do mesmo PMO usa o cache do navegador', async () => {
    let resolver!: (v: EstoqueCompels) => void
    lerEstoqueCompelsAction.mockReturnValue(new Promise<EstoqueCompels>((r) => { resolver = r }))
    const primeira = render(createElement(EstoqueCompelsCard, { pmo: 'PMO-G' }))
    expect(screen.getByText('consultando…')).toBeInTheDocument()
    resolver(OK)
    expect(await screen.findByText(/1\.234,5 UN/)).toBeInTheDocument()
    primeira.unmount()

    lerEstoqueCompelsAction.mockClear()
    render(createElement(EstoqueCompelsCard, { pmo: 'PMO-G' }))
    expect(screen.getByText(/1\.234,5 UN/)).toBeInTheDocument()
    expect(lerEstoqueCompelsAction).not.toHaveBeenCalled()
  })
})
