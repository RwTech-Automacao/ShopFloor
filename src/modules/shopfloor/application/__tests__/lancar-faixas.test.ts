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
const BASE = { colaborador: 'Ana', posto: 'Embalagem', pmo: 'PMOF', op: '8682_F', numeroCaixa: 'CX[1]', qtdPorCaixa: '500' }

// O caso real: 993 etiquetas certas + 7 impressas com um dígito a mais.
const OP_8682 = {
  cliente: 'C', descricao: 'd', qtd: 1000, sn_ini: '0845801001', sn_fim: '0845801993', postos: ['Embalagem'],
  faixas: [
    { sn_ini: '0845801001', sn_fim: '0845801993' },
    { sn_ini: '08458001024', sn_fim: '08458001030' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue({ perfil: { porModulo: { shopfloor: { lancar: true } } } })
  mapaPostoPerfil.mockResolvedValue({ Embalagem: PERFIL_CAIXA })
  carregarOrdem.mockResolvedValue(OP_8682)
  chamarSfLancar.mockResolvedValue({ ok: true, caixa_count: 1, pecas: 1 })
})

describe('lancar — OP com várias faixas de SN (0181)', () => {
  it('SN da segunda faixa (um dígito a mais) é aceito', async () => {
    const r = await lancar({ ...BASE, numeroSerie: '08458001027' })
    expect(r.ok).toBe(true)
    expect(chamarSfLancar).toHaveBeenCalledWith(expect.objectContaining({ p_numero_serie: '08458001027' }))
  })

  it('SN da primeira faixa continua aceito', async () => {
    expect((await lancar({ ...BASE, numeroSerie: '0845801500' })).ok).toBe(true)
  })

  it('SN fora de todas as faixas é recusado', async () => {
    expect(await lancar({ ...BASE, numeroSerie: '08458001031' })).toEqual({ ok: false, erro: 'Nº de Série fora da faixa desta OP.' })
    expect(chamarSfLancar).not.toHaveBeenCalled()
  })

  it('zeros emendados num SN da faixa 1 são recusados pelo tamanho DELA, mesmo a faixa 2 sendo mais longa', async () => {
    expect(await lancar({ ...BASE, numeroSerie: '00845801500' })).toEqual({
      ok: false,
      erro: 'Nº de Série com caracteres a mais — leia o código novamente.',
    })
  })

  it('OP sem faixa nenhuma é barrada como antes', async () => {
    carregarOrdem.mockResolvedValue({ ...OP_8682, sn_ini: '', sn_fim: '', faixas: [] })
    expect(await lancar({ ...BASE, numeroSerie: '1' })).toEqual({ ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' })
  })
})
