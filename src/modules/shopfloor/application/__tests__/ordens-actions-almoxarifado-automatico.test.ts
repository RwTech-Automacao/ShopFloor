// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  criarOrdem: vi.fn(async (..._a: unknown[]) => 'id-novo'),
  atualizarOrdem: vi.fn(async (..._a: unknown[]) => undefined),
  mapa: vi.fn(async () => ({}) as Record<string, { recurso: string }>),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {} })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: m.mapa }))
vi.mock('../../infra/ordem-repository', () => ({
  criarOrdem: m.criarOrdem,
  atualizarOrdem: m.atualizarOrdem,
  excluirOrdem: vi.fn(),
  contarRegistros: vi.fn(),
  buscarOrdemBase: vi.fn(async () => ({ pmo: 'PMO1', op: '100', status: 'ATIVA' })),
  buscarOpEmUso: vi.fn(async () => null),
  listarPostos: vi.fn(async () => [{ chave: 'Teste' }, { chave: 'Embalagem' }, { chave: 'Almoxarifado' }, { chave: 'Estoque2' }]),
}))

import { criarOrdemAction, editarOrdemAction } from '../ordens-actions'

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
const postosGravados = (fn: typeof m.criarOrdem | typeof m.atualizarOrdem, i: number) => fn.mock.calls[0]?.[i]

beforeEach(() => {
  vi.clearAllMocks()
  m.mapa.mockResolvedValue({ Teste: { recurso: 'nenhum' }, Embalagem: { recurso: 'caixa' }, Almoxarifado: { recurso: 'almoxarifado' } })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('posto Almoxarifado automático em OP nova', () => {
  it('DESLIGADO (variável ausente): a rota grava exatamente o que o form mandou', async () => {
    const r = await criarOrdemAction(undefined, formulario(['Teste', 'Embalagem']))
    expect(r.ok).toBe(true)
    expect(postosGravados(m.criarOrdem, 1)).toEqual(['Teste', 'Embalagem'])
  })

  it('DESLIGADO com valor diferente de "1": também não mexe', async () => {
    vi.stubEnv('ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS', 'true')
    await criarOrdemAction(undefined, formulario(['Teste']))
    expect(postosGravados(m.criarOrdem, 1)).toEqual(['Teste'])
  })

  it('LIGADO: acrescenta o Almoxarifado como último (padrão antigo vira rota com ele no fim)', async () => {
    vi.stubEnv('ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS', '1')
    await criarOrdemAction(undefined, formulario(['Teste', 'Embalagem']))
    expect(postosGravados(m.criarOrdem, 1)).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('LIGADO e já presente: não duplica', async () => {
    vi.stubEnv('ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS', '1')
    await criarOrdemAction(undefined, formulario(['Teste', 'Almoxarifado']))
    expect(postosGravados(m.criarOrdem, 1)).toEqual(['Teste', 'Almoxarifado'])
  })

  it('LIGADO sem posto de perfil Almoxarifado: cria sem ele', async () => {
    vi.stubEnv('ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS', '1')
    m.mapa.mockResolvedValue({ Teste: { recurso: 'nenhum' } })
    const r = await criarOrdemAction(undefined, formulario(['Teste']))
    expect(r.ok).toBe(true)
    expect(postosGravados(m.criarOrdem, 1)).toEqual(['Teste'])
  })

  it('LIGADO com mais de um posto de perfil Almoxarifado: recusa e não cria', async () => {
    vi.stubEnv('ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS', '1')
    m.mapa.mockResolvedValue({ Almoxarifado: { recurso: 'almoxarifado' }, Estoque2: { recurso: 'almoxarifado' } })
    const r = await criarOrdemAction(undefined, formulario(['Almoxarifado']))
    expect(r).toEqual({ ok: false, erro: 'Há mais de um posto com perfil Almoxarifado; mantenha só um.' })
    expect(m.criarOrdem).not.toHaveBeenCalled()
  })

  it('EDITAR nunca recebe o posto sozinho, nem com a variável ligada', async () => {
    vi.stubEnv('ALMOXARIFADO_AUTOMATICO_NAS_OPS_NOVAS', '1')
    const r = await editarOrdemAction(undefined, formulario(['Teste', 'Embalagem']))
    expect(r.ok).toBe(true)
    expect(postosGravados(m.atualizarOrdem, 2)).toEqual(['Teste', 'Embalagem'])
  })
})
