import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PERFIL_PADRAO } from '@/modules/shopfloor/domain/perfil-posto'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

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

  it('chama a busca com a PEÇA certa, o SN normalizado e um resolvedor de perfil que usa o mapa', async () => {
    const manutencao = { ...PERFIL_PADRAO, chave: 'manutencao', recurso: 'manutencao' as const }
    mapaPostoPerfil.mockResolvedValue({ 'Reparo Central': manutencao })
    const sn = ' sn-1 '
    expect(normalizarSerie(sn)).not.toBe(sn) // o SN precisa de normalização, senão o teste não prova nada
    await verificarConsertoManutencao('P1', '7', sn, 'Inspeção PTH')
    expect(buscarUltimoReparo).toHaveBeenCalledWith('P1', '7', normalizarSerie(sn), expect.any(Function))
    // O callback é o que reconhece a Manutenção: sem o mapa, o modal nunca apareceria.
    const perfilDe = buscarUltimoReparo.mock.calls[0]![3] as (p: string) => typeof PERFIL_PADRAO
    expect(perfilDe('Reparo Central').recurso).toBe('manutencao')
    expect(perfilDe('Qualquer outro')).toEqual(PERFIL_PADRAO)
  })
})
