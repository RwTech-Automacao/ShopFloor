// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Almoxarifado obrigatório (09/11/2026), garantido no SERVIDOR: a OP nova sempre fecha a rota no
 * Almoxarifado, mesmo que o formulário não o mande; na edição, se a rota GRAVADA já tem o posto, ele
 * não sai e continua por último; OP antiga sem ele nunca o ganha.
 */

const m = vi.hoisted(() => ({
  criarOrdem: vi.fn(async (_dados: unknown, _postos: string[]) => 'id-novo'),
  atualizarOrdem: vi.fn(async (_id: string, _dados: unknown, _postos: string[]) => undefined),
  buscarOrdemBase: vi.fn(async (_id: string) => ({ pmo: 'PMO1', op: '100', status: 'ATIVA', placas_por_painel: 1 })),
  listarRotaGravada: vi.fn(async (_id: string): Promise<string[]> => []),
  listarPostos: vi.fn(async () => [{ chave: 'Teste' }, { chave: 'Embalagem' }, { chave: 'Almoxarifado' }]),
  mapaPostoPerfil: vi.fn(async (): Promise<Record<string, { recurso: string }>> => ({ Almoxarifado: { recurso: 'almoxarifado' }, Embalagem: { recurso: 'caixa' } })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: m.mapaPostoPerfil }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: m.criarOrdem,
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(async () => 0),
  buscarOrdemBase: m.buscarOrdemBase,
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: m.listarPostos,
  listarRotaGravada: m.listarRotaGravada,
  contarSnsForaDasFaixas: vi.fn(async () => 0),
}))

import { criarOrdemAction, editarOrdemAction } from '../ordens-actions'
import { MSG_ALMOXARIFADO_OBRIGATORIO } from '../../domain/rota-op-nova'

function formulario(fluxo: string[]): FormData {
  const fd = new FormData()
  fd.set('id', 'id-1')
  fd.set('pmo', 'PMO1')
  fd.set('op', '100')
  fd.set('cliente', 'Cliente')
  fd.set('qtd', '2')
  fd.set('status', 'ATIVA')
  fd.set('sn_ini', 'SN0001')
  fd.set('sn_fim', 'SN0002')
  fd.set('fluxo', JSON.stringify(fluxo))
  return fd
}

beforeEach(() => {
  vi.clearAllMocks()
  m.listarRotaGravada.mockResolvedValue([])
  m.mapaPostoPerfil.mockResolvedValue({ Almoxarifado: { recurso: 'almoxarifado' }, Embalagem: { recurso: 'caixa' } })
})

describe('criar OP: Almoxarifado obrigatório no fim', () => {
  it('o formulário não manda o Almoxarifado: o servidor o acrescenta por último', async () => {
    const r = await criarOrdemAction(undefined, formulario(['Teste', 'Embalagem']))
    expect(r.ok).toBe(true)
    expect(m.criarOrdem.mock.calls[0]?.[1]).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('o formulário manda o Almoxarifado no meio: vai para o fim, sem duplicar', async () => {
    await criarOrdemAction(undefined, formulario(['Almoxarifado', 'Teste']))
    expect(m.criarOrdem.mock.calls[0]?.[1]).toEqual(['Teste', 'Almoxarifado'])
  })

  it('rota vazia: a OP nasce só com o Almoxarifado', async () => {
    await criarOrdemAction(undefined, formulario([]))
    expect(m.criarOrdem.mock.calls[0]?.[1]).toEqual(['Almoxarifado'])
  })

  it('sem posto de perfil almoxarifado no catálogo, segue sem ele', async () => {
    m.mapaPostoPerfil.mockResolvedValue({})
    await criarOrdemAction(undefined, formulario(['Teste']))
    expect(m.criarOrdem.mock.calls[0]?.[1]).toEqual(['Teste'])
  })
})

describe('editar OP: trava pela rota gravada', () => {
  it('OP gravada com Almoxarifado: retirar é recusado e nada é gravado', async () => {
    m.listarRotaGravada.mockResolvedValue(['Teste', 'Almoxarifado'])
    const r = await editarOrdemAction(undefined, formulario(['Teste']))
    expect(r).toEqual({ ok: false, erro: MSG_ALMOXARIFADO_OBRIGATORIO })
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
    expect(m.listarRotaGravada).toHaveBeenCalledWith('id-1')
  })

  it('OP gravada com Almoxarifado: movido no formulário, volta para o fim', async () => {
    m.listarRotaGravada.mockResolvedValue(['Teste', 'Almoxarifado'])
    const r = await editarOrdemAction(undefined, formulario(['Almoxarifado', 'Teste', 'Embalagem']))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem.mock.calls[0]?.[2]).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('OP antiga sem Almoxarifado: nada é acrescentado', async () => {
    m.listarRotaGravada.mockResolvedValue(['Teste', 'Embalagem'])
    const r = await editarOrdemAction(undefined, formulario(['Embalagem', 'Teste']))
    expect(r.ok).toBe(true)
    expect(m.atualizarOrdem.mock.calls[0]?.[2]).toEqual(['Embalagem', 'Teste'])
  })

  it('falha ao ler a rota gravada: recusa sem gravar (fail-closed)', async () => {
    m.listarRotaGravada.mockRejectedValue(new Error('x'))
    const r = await editarOrdemAction(undefined, formulario(['Teste']))
    expect(r.ok).toBe(false)
    expect(m.atualizarOrdem).not.toHaveBeenCalled()
  })
})
