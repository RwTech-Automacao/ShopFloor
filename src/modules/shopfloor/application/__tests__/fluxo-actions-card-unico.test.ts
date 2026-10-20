import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { carregarFluxoOp } = vi.hoisted(() => ({ carregarFluxoOp: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({
  getSessao: async () => ({
    usuarioId: 'u1', nome: 'G', email: 'g@x',
    perfil: { porModulo: { shopfloor: { visualizar: true } }, permissoes: {} },
  }),
}))
vi.mock('@/modules/shopfloor/infra/fluxo-repository', () => ({ carregarFluxoOp }))

import { carregarFluxo } from '../fluxo-actions'

const fluxo = (postos: string[], recurso: Record<string, string>) => ({
  postos, agregados: [], temStatus: {}, recurso, exigeManutencao: {}, qtd: 10, naoIniciadas: 2, finalizadas: 3,
})

beforeEach(() => carregarFluxoOp.mockReset())

describe('carregarFluxo: card único', () => {
  it('OP com Almoxarifado em último: sem nó Concluído; o Almoxarifado leva mostrarEstoque', async () => {
    carregarFluxoOp.mockResolvedValue(fluxo(['Teste', 'Almoxarifado'], { Almoxarifado: 'almoxarifado' }))
    const r = await carregarFluxo('PMO1', '10')
    if (!r.ok) throw new Error(r.erro)
    expect(r.nodes.some((n) => n.id === 'Saída')).toBe(false)
    expect(r.edges.some((e) => e.target === 'Saída')).toBe(false)
    expect(r.nodes.find((n) => n.id === 'Almoxarifado')!.data.mostrarEstoque).toBe(true)
  })

  it('OP sem Almoxarifado em último (a imensa maioria): Concluído de sempre', async () => {
    carregarFluxoOp.mockResolvedValue(fluxo(['Teste', 'Embalagem'], { Embalagem: 'caixa' }))
    const r = await carregarFluxo('PMO1', '10')
    if (!r.ok) throw new Error(r.erro)
    expect(r.nodes.some((n) => n.id === 'Saída')).toBe(true)
    expect(r.edges.some((e) => e.id === 'f:Embalagem->Saída')).toBe(true)
    expect(r.nodes.some((n) => n.data.mostrarEstoque)).toBe(false)
  })
})
