// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  criarOrdem: vi.fn(async (_dados: Record<string, unknown>) => 'id-novo'),
  atualizarOrdem: vi.fn(async (_id: string, _dados: Record<string, unknown>) => undefined),
  buscarOrdemBase: vi.fn(async (_id: string) => ({ pmo: 'PMO1', op: '100', status: 'ATIVA' }) as { pmo: string; op: string; status: string } | null),
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
  buscarOrdemBase: m.buscarOrdemBase,
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

beforeEach(() => {
  vi.clearAllMocks()
  m.criarOrdem.mockResolvedValue('id-novo')
  m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMO1', op: '100', status: 'ATIVA' })
})

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

describe('reativar na mão tira a OP do controle automático (0148)', () => {
  it('FINALIZADA -> ATIVA grava reaberta_manual = true', async () => {
    m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMO1', op: '100', status: 'FINALIZADA' })

    const r = await editarOrdemAction(undefined, formulario('ATIVA'))

    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem.mock.calls[0]?.[1]).toMatchObject({ status: 'ATIVA', finalizada_por: null, reaberta_manual: true })
  })

  it('editar uma OP que já estava ATIVA não mexe na marca', async () => {
    // Marcar aqui desligaria a finalização automática de qualquer OP só por ter sido editada.
    await editarOrdemAction(undefined, formulario('ATIVA'))

    expect(m.atualizarOrdem.mock.calls[0]?.[1]).not.toHaveProperty('reaberta_manual')
  })

  it('finalizar na mão não mexe na marca (quem protege aí é finalizada_por)', async () => {
    m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMO1', op: '100', status: 'ATIVA' })

    await editarOrdemAction(undefined, formulario('FINALIZADA'))

    expect(m.atualizarOrdem.mock.calls[0]?.[1]).not.toHaveProperty('reaberta_manual')
  })

  it('a marca é definitiva: nada no cadastro a apaga', async () => {
    // Reativou (marca ligada), depois finalizou, depois reativou nessa ordem -- a tela nunca grava
    // reaberta_manual = false, então a OP não volta ao automático por caminho nenhum.
    m.buscarOrdemBase.mockResolvedValue({ pmo: 'PMO1', op: '100', status: 'FINALIZADA' })
    await editarOrdemAction(undefined, formulario('ATIVA'))
    await editarOrdemAction(undefined, formulario('FINALIZADA'))

    for (const chamada of m.atualizarOrdem.mock.calls) {
      expect(chamada[1]).not.toMatchObject({ reaberta_manual: false })
    }
  })

  it('OP nova nasce no controle automático, mesmo criada ATIVA', async () => {
    // Se criar marcasse, a feature nunca fecharia OP nenhuma.
    await criarOrdemAction(undefined, formulario('ATIVA'))

    expect(m.criarOrdem.mock.calls[0]?.[0]).not.toHaveProperty('reaberta_manual')
  })

  it('o formulário não consegue forjar a marca', async () => {
    const fd = formulario('FINALIZADA')
    fd.set('reaberta_manual', 'true')

    await editarOrdemAction(undefined, fd)

    expect(m.atualizarOrdem.mock.calls[0]?.[1]).not.toHaveProperty('reaberta_manual')
  })
})
