// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Base = {
  pmo: string; op: string; status: string; placas_por_painel: number
  sn_ini?: string; sn_fim?: string; faixas?: { sn_ini: string; sn_fim: string }[]
}
const m = vi.hoisted(() => ({
  criarOrdem: vi.fn<(...a: unknown[]) => Promise<string>>(async () => 'id-novo'),
  atualizarOrdem: vi.fn<(...a: unknown[]) => Promise<undefined>>(async () => undefined),
  buscarOrdemBase: vi.fn<(id: string) => Promise<Base | null>>(async () => null),
  contarSnsForaDasFaixas: vi.fn<(pmo: string, op: string, f: unknown) => Promise<number>>(async () => 0),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
// A OP destes testes não tem estrutura aplicada (a trava da troca de PMO tem o seu próprio teste).
vi.mock('../../infra/estrutura-repository', async (original) => ({
  ...(await original<typeof import('../../infra/estrutura-repository')>()),
  ordemTemTrechos: vi.fn(async () => false),
}))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: m.criarOrdem,
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
  listarRotaGravada: vi.fn(async () => []),
  contarSnsForaDasFaixas: m.contarSnsForaDasFaixas,
}))

import { criarOrdemAction, editarOrdemAction } from '../ordens-actions'

const F1 = { sn_ini: '0845801001', sn_fim: '0845801993' }
const F2 = { sn_ini: '08458001024', sn_fim: '08458001030' }

function formulario(faixas: { sn_ini: string; sn_fim: string }[], extra: Record<string, string> = {}): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1')
  fd.set('pmo', 'PMOF')
  fd.set('op', '8682_F')
  fd.set('cliente', 'Cliente')
  fd.set('qtd', '1000')
  fd.set('status', 'ATIVA')
  fd.set('faixas', JSON.stringify(faixas))
  for (const [k, v] of Object.entries(extra)) fd.set(k, v)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  m.contarSnsForaDasFaixas.mockResolvedValue(0)
  m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMOF', op: '8682_F', status: 'ATIVA', placas_por_painel: 1, sn_ini: F1.sn_ini, sn_fim: F1.sn_fim, faixas: [F1, F2] })
})

describe('cadastro de OP com várias faixas de SN', () => {
  it('criar: grava a lista e a 1ª faixa em sn_ini/sn_fim', async () => {
    const r = await criarOrdemAction(undefined, formulario([F1, F2]))
    expect(r.ok).toBe(true)
    expect(m.criarOrdem.mock.calls[0]?.[0]).toMatchObject({ sn_ini: F1.sn_ini, sn_fim: F1.sn_fim })
    expect(m.criarOrdem.mock.calls[0]?.[4]).toEqual([F1, F2])
  })

  it('criar: soma das faixas diferente da quantidade é recusada', async () => {
    const r = await criarOrdemAction(undefined, formulario([F1]))
    expect(r).toEqual({ ok: false, erro: 'A quantidade (1000) não bate com a faixa de Nº de Série (993 números). Confira o SN inicial/final e a quantidade.' })
    expect(m.criarOrdem).not.toHaveBeenCalled()
  })

  it('formulário antigo (sn_ini/sn_fim, sem faixas) continua valendo como faixa única', async () => {
    const fd = formulario([])
    fd.delete('faixas')
    fd.set('sn_ini', 'SN0001')
    fd.set('sn_fim', 'SN1000')
    expect((await criarOrdemAction(undefined, fd)).ok).toBe(true)
    expect(m.criarOrdem.mock.calls[0]?.[4]).toEqual([{ sn_ini: 'SN0001', sn_fim: 'SN1000' }])
  })
})

describe('aviso ao editar faixas/PMO de OP com registros', () => {
  it('faixas iguais às gravadas: nem pergunta ao banco', async () => {
    const r = await editarOrdemAction(undefined, formulario([F1, F2]))
    expect(r.ok).toBe(true)
    expect(m.contarSnsForaDasFaixas).not.toHaveBeenCalled()
    expect(m.atualizarOrdem.mock.calls[0]?.[5]).toEqual([F1, F2])
  })

  it('faixas mudaram e nenhum SN sai: grava sem perguntar', async () => {
    const F2b = { sn_ini: '08458001024', sn_fim: '08458001029' }
    const F1b = { sn_ini: '0845801001', sn_fim: '0845801994' }
    const r = await editarOrdemAction(undefined, formulario([F1b, F2b]))
    expect(r.ok).toBe(true)
    expect(m.contarSnsForaDasFaixas).toHaveBeenCalledWith('PMOF', '8682_F', [F1b, F2b])
  })

  it('faixas mudaram e SNs ficariam de fora: pergunta e NÃO grava', async () => {
    m.contarSnsForaDasFaixas.mockResolvedValue(7)
    const F1b = { sn_ini: '0845801001', sn_fim: '0845802000' }
    const r = await editarOrdemAction(undefined, formulario([F1b]))
    expect(r).toEqual({ ok: false, erro: '7 registros ficariam fora das faixas novas. Salvar mesmo assim?', confirmarForaDaFaixa: 7 })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('confirmado: grava sem perguntar de novo', async () => {
    m.contarSnsForaDasFaixas.mockResolvedValue(7)
    const F1b = { sn_ini: '0845801001', sn_fim: '0845802000' }
    const r = await editarOrdemAction(undefined, formulario([F1b], { confirmar_fora_faixa: '1' }))
    expect(r.ok).toBe(true)
    expect(m.contarSnsForaDasFaixas).not.toHaveBeenCalled()
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
  })

  it('trocou o PMO: conta todos os SNs do par antigo (faixas null) e a mensagem diz qual', async () => {
    m.contarSnsForaDasFaixas.mockResolvedValue(1)
    const r = await editarOrdemAction(undefined, formulario([F1, F2], { pmo: 'PMOG' }))
    expect(m.contarSnsForaDasFaixas).toHaveBeenCalledWith('PMOF', '8682_F', null)
    expect(r).toEqual({ ok: false, erro: '1 registro ficaria no PMO/OP antigo (PMOF/8682_F). Salvar mesmo assim?', confirmarForaDaFaixa: 1 })
  })

  it('erro ao contar: não grava (fail-closed)', async () => {
    m.contarSnsForaDasFaixas.mockRejectedValue(new Error('x'))
    const r = await editarOrdemAction(undefined, formulario([F1]))
    expect(r).toEqual({ ok: false, erro: 'A quantidade (1000) não bate com a faixa de Nº de Série (993 números). Confira o SN inicial/final e a quantidade.' })
    const fd = formulario([{ sn_ini: '0845801001', sn_fim: '0845802000' }])
    expect(await editarOrdemAction(undefined, fd)).toEqual({ ok: false, erro: 'Não foi possível salvar a OP.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
})
