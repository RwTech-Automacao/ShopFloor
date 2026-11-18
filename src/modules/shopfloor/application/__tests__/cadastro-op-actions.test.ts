// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CadastroOp, OpEspelho } from '../../domain/cadastro-op'

vi.mock('server-only', () => ({}))
const m = vi.hoisted(() => ({
  cadastrarOp: vi.fn<(c: CadastroOp) => Promise<string>>(async () => 'uuid-1'), ultimaOpDaPmo: vi.fn(), listarEspelho: vi.fn(), buscarOpEmUso: vi.fn(async () => null),
  registrarLog: vi.fn(), podeNoModulo: vi.fn(() => true),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: {}, nome: 'Ana', email: 'a@x' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: m.podeNoModulo }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: m.registrarLog }))
vi.mock('../../infra/cadastro-op-repository', () => ({ cadastrarOp: m.cadastrarOp, ultimaOpDaPmo: m.ultimaOpDaPmo }))
vi.mock('../../infra/espelho-ops-repository', () => ({ listarEspelho: m.listarEspelho }))
vi.mock('../../infra/ordem-repository', () => ({
  buscarOpEmUso: m.buscarOpEmUso,
  listarPostos: vi.fn(async () => ['SPI', 'Inspeção AOI TOP', 'Inspeção PTH', 'Teste', 'Burn-in', 'Integração', 'Almoxarifado'].map((chave) => ({ chave }))),
}))
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({
  Almoxarifado: { recurso: 'almoxarifado' }, 'Burn-in': { recurso: 'burnin' }, 'Integração': { recurso: 'integracao' },
})) }))

import { cadastrarOpAction, ultimaOpDaPmoAction } from '../cadastro-op-actions'

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: '', situacao: 'Em Processo', nivel, quantidade: 10, quantidadeProduzida: 0,
  maeNumero: mae, principalNumero: null, cliente: '', dataDocumento: null, ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8500, 'PRT410', 2, 8498)]
const cad = (over: Partial<CadastroOp> = {}): CadastroOp => ({
  modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', descricao: '', qtd: 10, acp: '', embalagemIndividual: false, placasPorPainel: 1,
  trechos: [
    { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['SPI', 'Inspeção AOI TOP', 'Almoxarifado', 'Inexistente'], faixas: [] },
    { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['Teste', 'Burn-in'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
  ],
  componentes: [{ posto: 'Teste', pmo: 'PMOZ' }, { posto: 'Integração', pmo: 'PMOW' }],
  burnin: [{ posto: 'Burn-in', tempo_min: 360 }, { posto: 'Teste', tempo_min: 10 }],
  ...over,
})

beforeEach(() => { vi.clearAllMocks(); m.listarEspelho.mockResolvedValue(ESPELHO); m.podeNoModulo.mockReturnValue(true) })

describe('cadastrarOpAction', () => {
  it('limpa os postos (catálogo, Almoxarifado no fim da PMO), filtra componentes/burn-in e grava', async () => {
    expect(await cadastrarOpAction(cad())).toEqual({ ok: true, id: 'uuid-1', pmo: 'PMOC14', op: '8498' })
    const enviado = m.cadastrarOp.mock.calls[0]![0]
    expect(enviado.trechos.map((t) => t.postos)).toEqual([['SPI', 'Inspeção AOI TOP'], ['Teste', 'Burn-in', 'Almoxarifado']])
    expect(enviado.componentes).toEqual([])
    expect(enviado.burnin).toEqual([{ posto: 'Burn-in', tempo_min: 360 }])
    expect(m.registrarLog).toHaveBeenCalledWith(expect.objectContaining({ entidade: 'sf_ordem', entidadeId: 'uuid-1', acao: 'criar' }))
  })
  it('postos com espaço são aparados antes de conferir no catálogo; vazios saem', async () => {
    const c = cad()
    const trechos = [{ ...c.trechos[0]!, postos: [' SPI ', ''] }, { ...c.trechos[1]!, postos: ['  Teste', '   '] }]
    expect(await cadastrarOpAction({ ...c, trechos })).toMatchObject({ ok: true })
    const enviado = m.cadastrarOp.mock.calls[0]![0]
    expect(enviado.trechos.map((t) => t.postos)).toEqual([['SPI'], ['Teste', 'Almoxarifado']])
  })
  it('sem permissão', async () => {
    m.podeNoModulo.mockReturnValue(false)
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Você não tem permissão para gerenciar ordens de produção.' })
  })
  it('trechos que não batem com o espelho são recusados', async () => {
    m.listarEspelho.mockResolvedValue([op(8498, 'PMOC14', 1, null)])
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' })
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('Compels: o número da OP é o da PMO do espelho, com ou sem sufixo _XX', async () => {
    const MSG = 'O número da OP tem que ser o da OP do Compels (8498) ou ele com sufixo (ex.: 8498_F).'
    expect(await cadastrarOpAction(cad({ op: '9999' }))).toEqual({ ok: false, erro: MSG })
    expect(await cadastrarOpAction(cad({ op: '8498_' }))).toEqual({ ok: false, erro: MSG })
    expect(await cadastrarOpAction(cad({ op: '8498_F-1' }))).toEqual({ ok: false, erro: MSG })
    expect(m.cadastrarOp).not.toHaveBeenCalled()
    expect(await cadastrarOpAction(cad({ op: ' 8498_F ' }))).toMatchObject({ ok: true, op: '8498_F' })
  })
  it('Compels: o PMO tem que ser o código da PMO no espelho', async () => {
    const r = await cadastrarOpAction(cad({ pmo: 'PMOXXX' }))
    expect(r.ok).toBe(false)
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('Compels: OP que saiu da lista ativa do espelho não pode ser cadastrada', async () => {
    m.listarEspelho.mockResolvedValue([{ ...op(8498, 'PMOC14', 1, null), ativa: false }, op(8500, 'PRT410', 2, 8498)])
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'A OP 8498 não está mais ativa no Compels.' })
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('Compels: seq e tipo dos trechos também têm que bater', async () => {
    const c = cad()
    const msg = { ok: false, erro: 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.' }
    expect(await cadastrarOpAction({ ...c, trechos: [{ ...c.trechos[0]!, seq: 7 }, c.trechos[1]!] })).toEqual(msg)
    expect(await cadastrarOpAction({ ...c, trechos: [{ ...c.trechos[0]!, tipo: 'pmo' }, c.trechos[1]!] })).toEqual(msg)
    expect(m.cadastrarOp).not.toHaveBeenCalled()
  })
  it('validação do domínio', async () => {
    expect(await cadastrarOpAction(cad({ cliente: '' }))).toEqual({ ok: false, erro: 'Informe o cliente.' })
  })
  it('OP já cadastrada', async () => {
    m.buscarOpEmUso.mockResolvedValueOnce({ id: 'x', pmo: 'PMOC14', op: '8498' } as never)
    expect(await cadastrarOpAction(cad())).toMatchObject({ ok: false, erro: expect.stringContaining('Já existe a OP 8498') })
  })
  it('erros do banco em PT-BR', async () => {
    m.cadastrarOp.mockRejectedValueOnce({ code: '23505', message: 'dup' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Já existe uma OP com esse PMO e número.' })
    m.cadastrarOp.mockRejectedValueOnce({ message: 'POSTO_REPETIDO:Teste' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'O posto "Teste" está em mais de um trecho.' })
    m.cadastrarOp.mockRejectedValueOnce({ code: 'P0001', message: 'TRECHO_SEQ_REPETIDO' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Dois trechos estão com o mesmo número de ordem.' })
    m.cadastrarOp.mockRejectedValueOnce({ code: 'P0001', message: 'PMO_NAO_E_ULTIMO' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'A OP da PMO tem que ser o último trecho.' })
    m.cadastrarOp.mockRejectedValueOnce({ code: 'P0001', message: 'SEM_TRECHO' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'A OP precisa de pelo menos um trecho.' })
    m.cadastrarOp.mockRejectedValueOnce({ code: 'P0001', message: 'TRECHO_SEM_POSTO:PRT410' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'O trecho PRT410 ficaria sem posto.' })
    m.cadastrarOp.mockRejectedValueOnce({ code: 'P0001', message: 'TRECHO_SEM_FAIXA:PRT410' })
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'O trecho PRT410 ficaria sem faixa de SN.' })
    m.cadastrarOp.mockRejectedValueOnce(new Error('rede'))
    expect(await cadastrarOpAction(cad())).toEqual({ ok: false, erro: 'Não foi possível criar a OP.' })
  })
  it('modo manual: um trecho só, sem OP do Compels, não consulta o espelho', async () => {
    const manual = cad({ modo: 'manual', pmo: 'PMOZ', op: '9001', trechos: [
      { seq: 1, codigo: 'PMOZ', tipo: 'pmo', compelsOp: null, descricao: '', quantidade: null, situacao: '', snModo: 'mesmo', postos: ['Teste'], faixas: [{ sn_ini: '1001', sn_fim: '1010' }] },
    ] })
    expect(await cadastrarOpAction(manual)).toMatchObject({ ok: true })
    expect(m.listarEspelho).not.toHaveBeenCalled()
    expect(await cadastrarOpAction({ ...manual, trechos: [{ ...manual.trechos[0]!, compelsOp: '9001' }] })).toEqual({ ok: false, erro: 'Cadastro manual tem um trecho só, sem OP do Compels.' })
  })
})

describe('ultimaOpDaPmoAction', () => {
  it('lê a última OP; sem permissão ou erro = null', async () => {
    m.ultimaOpDaPmo.mockResolvedValueOnce({ op: '8476' })
    expect(await ultimaOpDaPmoAction(' PMOC14 ')).toEqual({ op: '8476' })
    expect(m.ultimaOpDaPmo).toHaveBeenCalledWith('PMOC14')
    m.podeNoModulo.mockReturnValue(false)
    expect(await ultimaOpDaPmoAction('PMOC14')).toBeNull()
  })
})
