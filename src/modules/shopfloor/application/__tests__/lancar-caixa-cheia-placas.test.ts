import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessao = vi.fn()
const mapaPostoPerfil = vi.fn()
const carregarOrdem = vi.fn()
const chamarSfLancar = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil, mapaPostoRotaDestino: vi.fn() }))
vi.mock('@/modules/shopfloor/infra/lote-repository', () => ({ criarLote: vi.fn(), snsPendentesDoLote: vi.fn() }))
vi.mock('@/modules/shopfloor/infra/lancamento-repository', () => ({
  carregarOrdem, chamarSfLancar, inserirConservoConfirmado: vi.fn(),
  chamarSfBurnin: vi.fn(), buscarEntradaBurninAberta: vi.fn(), buscarUltimaReprovaDoPosto: vi.fn(),
  buscarUltimoReparo: vi.fn(), contarLancadosNoPosto: vi.fn(),
}))

const { lancar } = await import('../lancar-action')

const PERFIL_CAIXA = { chave: 'emb', nome: 'Embalagem', temStatus: false, reprova: 'nenhum', gate: 'registrado', exigeManutencao: false, recurso: 'caixa' }
const BASE = {
  colaborador: 'Ana', posto: 'Embalagem', pmo: 'P1', op: '1', numeroSerie: '000123',
  numeroCaixa: 'CX[1]', qtdPorCaixa: '500',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue({ perfil: { porModulo: { shopfloor: { lancar: true } } } })
  mapaPostoPerfil.mockResolvedValue({ Embalagem: PERFIL_CAIXA })
  carregarOrdem.mockResolvedValue({
    cliente: 'C', descricao: 'd', qtd: 5000, sn_ini: '000001', sn_fim: '000999', postos: ['Embalagem'],
  })
})

describe('lancar — CAIXA_CHEIA com placas por painel', () => {
  it('painel de 50 placas que estoura: mensagem com N placas e X/Y', async () => {
    chamarSfLancar.mockResolvedValue({ ok: false, erro: 'CAIXA_CHEIA', pecas: 50, caixa_count: 500, limite: 500 })
    const r = await lancar(BASE)
    expect(r).toEqual({ ok: false, erro: 'Este painel (50 placas) ultrapassa o limite da caixa (500/500).' })
  })

  it('N=1: mantém a mensagem de sempre', async () => {
    chamarSfLancar.mockResolvedValue({ ok: false, erro: 'CAIXA_CHEIA', pecas: 1, caixa_count: 3, limite: 3 })
    const r = await lancar(BASE)
    expect(r).toEqual({ ok: false, erro: 'A caixa já atingiu o limite de peças.' })
  })

  it('sucesso devolve as placas do bipe', async () => {
    chamarSfLancar.mockResolvedValue({ ok: true, caixa_count: 50, pecas: 50 })
    const r = await lancar(BASE)
    expect(r).toEqual({ ok: true, caixaCount: 50, pecas: 50 })
  })

  it('embalagem individual com N=50: o limite 1 vira 50 (o painel é a caixa)', async () => {
    carregarOrdem.mockResolvedValue({
      cliente: 'C', descricao: 'd', qtd: 5000, sn_ini: '000001', sn_fim: '000999', postos: ['Embalagem'],
      embalagem_individual: true, placas_por_painel: 50,
    })
    chamarSfLancar.mockResolvedValue({ ok: true, caixa_count: 50, pecas: 50 })
    await lancar({ ...BASE, numeroCaixa: '000123', qtdPorCaixa: '1' })
    expect(chamarSfLancar).toHaveBeenCalledWith(expect.objectContaining({ p_qtd_por_caixa: 50 }))
  })

  it('embalagem individual sem painel (N=1): segue mandando 1', async () => {
    carregarOrdem.mockResolvedValue({
      cliente: 'C', descricao: 'd', qtd: 5000, sn_ini: '000001', sn_fim: '000999', postos: ['Embalagem'],
      embalagem_individual: true, placas_por_painel: 1,
    })
    chamarSfLancar.mockResolvedValue({ ok: true, caixa_count: 1, pecas: 1 })
    await lancar({ ...BASE, numeroCaixa: '000123', qtdPorCaixa: '1' })
    expect(chamarSfLancar).toHaveBeenCalledWith(expect.objectContaining({ p_qtd_por_caixa: 1 }))
  })
})
