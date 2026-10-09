import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessao = vi.fn()
const mapaPostoPerfil = vi.fn()
const carregarOrdem = vi.fn()
const chamarSfLancar = vi.fn()
const inserirConservoConfirmado = vi.fn()

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil, mapaPostoRotaDestino: vi.fn() }))
vi.mock('@/modules/shopfloor/infra/lote-repository', () => ({ criarLote: vi.fn(), snsPendentesDoLote: vi.fn() }))
vi.mock('@/modules/shopfloor/infra/lancamento-repository', () => ({
  carregarOrdem, chamarSfLancar, inserirConservoConfirmado,
  chamarSfBurnin: vi.fn(), buscarEntradaBurninAberta: vi.fn(), buscarUltimaReprovaDoPosto: vi.fn(),
  buscarUltimoReparo: vi.fn(), contarLancadosNoPosto: vi.fn(),
}))

const { lancar } = await import('../lancar-action')

const sessao = { perfil: { porModulo: { shopfloor: { lancar: true } } } }

const BASE = {
  colaborador: ' Ana ', posto: 'Inspeção PTH', pmo: 'P1', op: '1', numeroSerie: '000123', status: 'Aprovado',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue(sessao)
  mapaPostoPerfil.mockResolvedValue({})
  carregarOrdem.mockResolvedValue({
    cliente: 'C', descricao: 'd', qtd: 10, sn_ini: '000001', sn_fim: '000999', postos: ['Inspeção PTH'],
  })
  chamarSfLancar.mockResolvedValue({ ok: true })
  inserirConservoConfirmado.mockResolvedValue(undefined)
})

describe('lancar — auditoria do conserto confirmado', () => {
  it('conserto do POSTO: grava origem posto e conserto vazio, com o defeito', async () => {
    const r = await lancar({
      ...BASE, conservoConfirmado: [{ codigo: 'D01', posicao: 'R1', tipo: 'Solda' }],
    })
    expect(r.ok).toBe(true)
    expect(inserirConservoConfirmado).toHaveBeenCalledTimes(1)
    expect(inserirConservoConfirmado).toHaveBeenCalledWith([
      expect.objectContaining({
        colaborador: 'Ana', pmo: 'P1', op: '1', posto: 'Inspeção PTH',
        codigo: 'D01', posicao: 'R1', tipo: 'Solda', origem: 'posto', conserto: '',
      }),
    ])
  })

  it('conserto da MANUTENÇÃO: grava origem manutencao com a descrição e a posição de cada um', async () => {
    const r = await lancar({
      ...BASE,
      consertoManutencaoConfirmado: [
        { conserto: 'Ressolda', posicao: 'R12' },
        { conserto: 'Troca', posicao: 'C5' },
      ],
    })
    expect(r.ok).toBe(true)
    expect(inserirConservoConfirmado).toHaveBeenCalledTimes(1)
    expect(inserirConservoConfirmado).toHaveBeenCalledWith([
      expect.objectContaining({
        colaborador: 'Ana', pmo: 'P1', op: '1', posto: 'Inspeção PTH', numeroSerie: '000123',
        codigo: '', tipo: '', posicao: 'R12', origem: 'manutencao', conserto: 'Ressolda',
      }),
      expect.objectContaining({ posicao: 'C5', origem: 'manutencao', conserto: 'Troca' }),
    ])
  })

  it('sem confirmação nenhuma → não grava auditoria', async () => {
    await lancar({ ...BASE })
    expect(inserirConservoConfirmado).not.toHaveBeenCalled()
  })

  it('falha ao gravar a auditoria não derruba o lançamento', async () => {
    inserirConservoConfirmado.mockRejectedValue(new Error('boom'))
    const r = await lancar({ ...BASE, consertoManutencaoConfirmado: [{ conserto: 'Ressolda', posicao: 'R12' }] })
    expect(r.ok).toBe(true)
  })
})
