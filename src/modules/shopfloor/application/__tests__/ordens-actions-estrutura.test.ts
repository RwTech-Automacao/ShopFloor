// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

type Base = { pmo: string; op: string; status: string; placas_por_painel: number }
const m = vi.hoisted(() => ({
  atualizarOrdem: vi.fn(async (_id: string, _dados: Record<string, unknown>) => undefined),
  buscarOrdemBase: vi.fn(async (_id: string) => null as Base | null),
  ordemTemTrechos: vi.fn(async (_id: string) => false),
  aplicarEstruturaNaOp: vi.fn(async () => null as string | null),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({})) }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: vi.fn(async () => 'id-novo'),
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => []),
  listarRotaGravada: vi.fn(async () => []),
  contarSnsForaDasFaixas: vi.fn(async () => 0),
}))
vi.mock('../../infra/estrutura-repository', () => ({ ordemTemTrechos: m.ordemTemTrechos }))
vi.mock('../aplicar-estrutura', () => ({ aplicarEstruturaNaOp: m.aplicarEstruturaNaOp }))

import { editarOrdemAction } from '../ordens-actions'

function formulario(pmo: string, op = '100'): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1')
  fd.set('pmo', pmo)
  fd.set('op', op)
  fd.set('cliente', 'Cliente')
  fd.set('qtd', '10')
  fd.set('status', 'ATIVA')
  fd.set('sn_ini', 'SN0001')
  fd.set('sn_fim', 'SN0010')
  fd.set('placas_por_painel', '1')
  return fd
}

const RECUSA = 'Esta OP já tem estrutura aplicada: não é possível trocar a PMO.'

beforeEach(() => {
  vi.clearAllMocks()
  m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMOC14', op: '100', status: 'ATIVA', placas_por_painel: 1 })
  m.ordemTemTrechos.mockResolvedValue(false)
})

describe('troca de PMO numa OP com estrutura aplicada', () => {
  it('PMO trocada e a OP tem trechos: recusa e não grava', async () => {
    m.ordemTemTrechos.mockResolvedValue(true)
    expect(await editarOrdemAction(undefined, formulario('PMOX99'))).toEqual({ ok: false, erro: RECUSA })
    expect(m.ordemTemTrechos).toHaveBeenCalledWith('id-1')
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })

  it('PMO trocada e a OP sem trechos: grava', async () => {
    const r = await editarOrdemAction(undefined, formulario('PMOX99'))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem).toHaveBeenCalledTimes(1)
  })

  it('mesma PMO (só o número da OP muda) com trechos: grava, sem consultar os trechos', async () => {
    m.ordemTemTrechos.mockResolvedValue(true)
    const r = await editarOrdemAction(undefined, formulario('PMOC14', '101'))
    expect(r.ok).toBe(true)
    expect(m.ordemTemTrechos).not.toHaveBeenCalled()
  })

  it('falha ao ler os trechos: não grava (fail-closed)', async () => {
    m.ordemTemTrechos.mockRejectedValue(new Error('rede'))
    expect(await editarOrdemAction(undefined, formulario('PMOX99'))).toEqual({ ok: false, erro: 'Não foi possível salvar a OP.' })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
})
