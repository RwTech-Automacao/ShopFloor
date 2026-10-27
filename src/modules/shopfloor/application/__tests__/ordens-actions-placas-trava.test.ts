// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Base = { pmo: string; op: string; status: string; placas_por_painel: number }
const m = vi.hoisted(() => ({
  criarOrdem: vi.fn(async (_dados: Record<string, unknown>) => 'id-novo'),
  atualizarOrdem: vi.fn(async (_id: string, _dados: Record<string, unknown>) => undefined),
  contarRegistros: vi.fn(async (_pmo: string, _op: string) => 0),
  buscarOrdemBase: vi.fn(async (_id: string) => null as Base | null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: m.criarOrdem,
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: m.contarRegistros,
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
}))

import { criarOrdemAction, editarOrdemAction } from '../ordens-actions'

function formulario(n: string): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1')
  fd.set('pmo', 'PMO1')
  fd.set('op', '100')
  fd.set('cliente', 'Cliente')
  fd.set('qtd', String(10 * Number(n)))
  fd.set('status', 'ATIVA')
  fd.set('sn_ini', 'SN0001')
  fd.set('sn_fim', 'SN0010')
  fd.set('placas_por_painel', n)
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  m.criarOrdem.mockResolvedValue('id-novo')
  m.contarRegistros.mockResolvedValue(0)
  // PMO/OP gravados diferem dos do formulário: a contagem deve usar o par ORIGINAL.
  m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMOORIG', op: '99', status: 'ATIVA', placas_por_painel: 1 })
})

describe('trava de "placas por painel" quando a OP já tem registros', () => {
  it('N alterado com registros: recusa e não grava', async () => {
    m.contarRegistros.mockResolvedValue(3)
    const r = await editarOrdemAction(undefined, formulario('50'))
    expect(r).toEqual({ ok: false, erro: 'Esta OP já tem registros; não é possível alterar as placas por painel.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
    expect(m.contarRegistros).toHaveBeenCalledWith('PMOORIG', '99')
  })

  it('N alterado sem registros: grava', async () => {
    const r = await editarOrdemAction(undefined, formulario('50'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem.mock.calls[0]?.[1]).toMatchObject({ placas_por_painel: 50 })
  })

  it('N igual com registros: grava (inclusive 1 -> 1)', async () => {
    m.contarRegistros.mockResolvedValue(3)
    const r = await editarOrdemAction(undefined, formulario('1'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
  })

  it('N igual (50 -> 50) com registros: grava', async () => {
    m.contarRegistros.mockResolvedValue(3)
    m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMOORIG', op: '99', status: 'ATIVA', placas_por_painel: 50 })
    const r = await editarOrdemAction(undefined, formulario('50'))
    expect(r.ok).toBe(true)
  })

  it('criar não é afetado', async () => {
    m.contarRegistros.mockResolvedValue(3)
    const r = await criarOrdemAction(undefined, formulario('50'))
    expect(r.ok).toBe(true)
    expect(m.contarRegistros).not.toHaveBeenCalled()
  })
})
