// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  criarOrdem: vi.fn(async (_dados: Record<string, unknown>) => 'id-novo'),
  atualizarOrdem: vi.fn(async (_id: string, _dados: Record<string, unknown>) => undefined),
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
  contarRegistros: vi.fn(),
  buscarOrdemBase: vi.fn(),
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
}))

import { criarOrdemAction, editarOrdemAction } from '../ordens-actions'

function formulario(status: string): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1')
  fd.set('pmo', 'PMO1')
  fd.set('op', '100')
  fd.set('cliente', 'Cliente')
  fd.set('qtd', '2')
  fd.set('status', status)
  fd.set('sn_ini', 'SN0001')
  fd.set('sn_fim', 'SN0002')
  return fd
}

beforeEach(() => vi.clearAllMocks())

describe('o cadastro de OP marca quem finalizou', () => {
  it('editar para FINALIZADA grava finalizada_por = manual', async () => {
    const r = await editarOrdemAction(undefined, formulario('FINALIZADA'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
    expect(m.atualizarOrdem.mock.calls[0]?.[1]).toMatchObject({ status: 'FINALIZADA', finalizada_por: 'manual' })
  })

  it('editar para ATIVA limpa a marca (reabrir à mão)', async () => {
    const r = await editarOrdemAction(undefined, formulario('ATIVA'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem.mock.calls[0]?.[1]).toMatchObject({ status: 'ATIVA', finalizada_por: null })
  })

  it('criar já FINALIZADA também é manual', async () => {
    const r = await criarOrdemAction(undefined, formulario('FINALIZADA'))
    expect(r.ok).toBe(true)
    expect(m.criarOrdem.mock.calls[0]?.[0]).toMatchObject({ finalizada_por: 'manual' })
  })

  it('o formulário não consegue forjar "rotina": o campo do cliente é ignorado', async () => {
    const fd = formulario('FINALIZADA')
    fd.set('finalizada_por', 'rotina')
    await editarOrdemAction(undefined, fd)
    expect(m.atualizarOrdem.mock.calls[0]?.[1]).toMatchObject({ finalizada_por: 'manual' })
  })
})
