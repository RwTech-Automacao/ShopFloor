import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessao = vi.fn()
const mapaPostoPerfil = vi.fn()
const mapaPostoRotaDestino = vi.fn()
const buscarUltimoReparo = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil, mapaPostoRotaDestino }))
vi.mock('@/modules/shopfloor/infra/lancamento-repository', () => ({ buscarUltimoReparo }))

const { verificarConsertoManutencao } = await import('../lancar-action')

// Forma real: Perfil.porModulo[modulo][acao] (ver auth/domain/perfil.ts).
const sessaoCom = (lancar: boolean) => ({ perfil: { porModulo: { shopfloor: { lancar } } } })

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(sessaoCom(true))
  mapaPostoPerfil.mockResolvedValue({})
  mapaPostoRotaDestino.mockResolvedValue(new Set(['Inspeção PTH']))
  buscarUltimoReparo.mockResolvedValue([{ conserto: 'Ressolda', posicao: 'R12' }])
})

describe('verificarConsertoManutencao', () => {
  it('posto é destino de rota e a peça veio da Manutenção → devolve os consertos', async () => {
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toEqual([
      { conserto: 'Ressolda', posicao: 'R12' },
    ])
  })

  it('posto NÃO é destino de rota → nulo, e NEM consulta o banco', async () => {
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Teste')).toBeNull()
    expect(buscarUltimoReparo).not.toHaveBeenCalled()
  })

  it('sem sessão → nulo', async () => {
    getSessao.mockResolvedValue(null)
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })

  it('sem permissão de lançar → nulo', async () => {
    getSessao.mockResolvedValue(sessaoCom(false))
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })

  it('erro no banco → nulo, não lança (fail-open)', async () => {
    buscarUltimoReparo.mockRejectedValue(new Error('boom'))
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })

  it('erro ao carregar os mapas → nulo, não lança', async () => {
    mapaPostoRotaDestino.mockRejectedValue(new Error('boom'))
    expect(await verificarConsertoManutencao('P1', '1', 'SN1', 'Inspeção PTH')).toBeNull()
  })
})
