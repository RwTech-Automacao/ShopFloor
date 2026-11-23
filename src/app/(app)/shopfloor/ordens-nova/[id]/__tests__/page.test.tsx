import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const getSessao = vi.fn()
const podeNoModulo = vi.fn()
const repo = vi.hoisted(() => ({ buscarOrdemComTrechos: vi.fn(), contarRegistros: vi.fn(), listarOrdens: vi.fn(), listarPostos: vi.fn() }))
const notFound = vi.hoisted(() => vi.fn(() => { throw new Error('NOT_FOUND') }))
const redirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }))
vi.mock('next/navigation', () => ({ notFound, redirect }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: () => getSessao() }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: (...a: unknown[]) => podeNoModulo(...a) }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => null }))
vi.mock('@/modules/shopfloor/infra/ordem-repository', () => repo)
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn().mockResolvedValue({}) }))
vi.mock('@/modules/shopfloor/infra/espelho-ops-repository', () => ({ listarEspelho: vi.fn().mockRejectedValue(new Error('x')) }))
vi.mock('@/modules/shopfloor/infra/estrutura-repository', () => ({ resumoTrechosDaOp: vi.fn().mockRejectedValue(new Error('x')) }))
vi.mock('../editar-op-cliente', () => ({ EditarOpCliente: () => null }))

const { default: EditarOpPage } = await import('../page')
const { EditarOpCliente } = await import('../editar-op-cliente')
const { SemPermissao } = await import('@/shared/ui/sem-permissao')

const ID = '00000000-0000-0000-0000-000000000001'
const ORDEM = {
  id: ID, pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: '', acp: '', status: 'ATIVA', sn_ini: '1', sn_fim: '10',
  embalagem_individual: false, placas_por_painel: 1, created_at: '', sf_ordem_componentes: [], sf_ordem_burnin: [], sf_ordem_faixas: [],
  sf_ordem_postos: [{ posto: 'Teste', ordem: 0, trecho_seq: 1 }],
  sf_ordem_trechos: [{ seq: 1, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498', sn_modo: 'mesmo' }],
}
const abrir = (id = ID) => EditarOpPage({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue({ email: 'a@x', perfil: {} })
  podeNoModulo.mockReturnValue(true)
  repo.buscarOrdemComTrechos.mockResolvedValue(ORDEM)
  repo.contarRegistros.mockResolvedValue(3)
  repo.listarOrdens.mockResolvedValue([{ cliente: 'LINCE' }, { cliente: '' }])
  repo.listarPostos.mockResolvedValue([{ chave: 'Teste' }, { chave: 'Manutenção' }])
})

describe('página de edição de OP com trechos', () => {
  it('quem não administra o ShopFloor não entra (e basta administrar: sem trava por e-mail)', async () => {
    podeNoModulo.mockReturnValue(false)
    expect((await abrir()).type).toBe(SemPermissao)
    expect(repo.buscarOrdemComTrechos).not.toHaveBeenCalled()
  })
  it('id inválido ou OP inexistente: 404', async () => {
    await expect(abrir('abc')).rejects.toThrow('NOT_FOUND')
    repo.buscarOrdemComTrechos.mockResolvedValue(null)
    await expect(abrir()).rejects.toThrow('NOT_FOUND')
  })
  it('OP sem trechos volta para a lista (edita no modal antigo)', async () => {
    repo.buscarOrdemComTrechos.mockResolvedValue({ ...ORDEM, sf_ordem_trechos: [] })
    await expect(abrir()).rejects.toThrow('REDIRECT:/shopfloor/ordens-nova')
  })
  it('monta a edição: trechos, registros e sem espelho/resumo quando a leitura falha', async () => {
    const el = await abrir()
    const cliente = (el.props.children as React.ReactElement[]).find((c) => c?.type === EditarOpCliente)!
    const p = cliente.props as Record<string, unknown>
    expect(p.temRegistros).toBe(true)
    expect(p.resumo).toBeNull()
    expect(p.postos).toEqual(['Teste'])
    expect(p.clientesExistentes).toEqual(['LINCE'])
    expect((p.trechos as { postos: string[] }[])[0]!.postos).toEqual(['Teste'])
  })
})
