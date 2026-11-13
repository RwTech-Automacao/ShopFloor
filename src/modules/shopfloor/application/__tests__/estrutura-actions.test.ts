import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({
  listarEstruturas: vi.fn(), salvarEstrutura: vi.fn(), marcarAtiva: vi.fn(), rotaDeReferencia: vi.fn(),
  ultimaOpNumericaPorPmo: vi.fn(), copiarParaOp: vi.fn(), gravarFilhas: vi.fn(), trechosDaOp: vi.fn(), estruturaDaPmo: vi.fn(),
}))
const compels = vi.hoisted(() => ({ lerDescendentes: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: 'admin', nome: 'Matheus', email: 'm@x' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn() }))
vi.mock('../../infra/estrutura-repository', () => repo)
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({ Almoxarifado: { recurso: 'almoxarifado' } })) }))
vi.mock('@/modules/compels/infra/cliente', () => ({ ClienteCompels: vi.fn(function () { return compels }) }))
vi.mock('@/modules/compels/infra/config', () => ({ configDoAmbiente: vi.fn(() => ({})), ConfiguracaoIncompleta: class extends Error {} }))

import { ativarEstruturaAction, importarDoCompelsAction, lerDoCompelsAction, salvarEstruturaAction } from '../estrutura-actions'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'

const ROTA = ['Inspeção AOI TOP', 'Montagem PTH', 'Inspeção PTH', 'Teste', 'Almoxarifado']
beforeEach(() => { vi.clearAllMocks(); repo.rotaDeReferencia.mockResolvedValue(ROTA) })

describe('lerDoCompelsAction', () => {
  it('lê a árvore da OP e devolve os trechos sugeridos', async () => {
    compels.lerDescendentes.mockResolvedValue([
      { numero: 8499, codigo: 'PRT420', descricao: 'PARTES PTH', nivel: 2, mae: 8498, principal: 8498, status: '' },
      { numero: 8500, codigo: 'PRT410', descricao: 'PARTES SMD', nivel: 3, mae: 8499, principal: 8498, status: '' },
    ])
    const r = await lerDoCompelsAction('PMOC14', '8498')
    expect(r).toMatchObject({ ok: true, trechos: [{ codigo: 'PRT410', postoConclui: 'Inspeção AOI TOP' }, { codigo: 'PRT420', postoConclui: 'Inspeção PTH' }] })
  })
  it('OP com sufixo (_F) consulta o número sem sufixo', async () => {
    compels.lerDescendentes.mockResolvedValue([])
    await lerDoCompelsAction('PMOF52_F', '8682_F')
    expect(compels.lerDescendentes).toHaveBeenCalledWith(8682)
  })
})

describe('ativarEstruturaAction', () => {
  it('recusa com as mensagens da validação', async () => {
    repo.estruturaDaPmo.mockResolvedValue({ pmo: 'P', situacao: 'rascunho', origem: 'manual', trechos: [{ seq: 1, codigo: 'PRT1', descricao: '', postoConclui: null, snModo: 'mesmo', estoque: 'EINTER' }] })
    expect(await ativarEstruturaAction('P')).toEqual({ ok: false, erro: 'PRT1: escolha o posto que conclui este trecho.' })
    expect(repo.marcarAtiva).not.toHaveBeenCalled()
  })
  it('ativa quando está tudo certo', async () => {
    repo.estruturaDaPmo.mockResolvedValue({ pmo: 'P', situacao: 'rascunho', origem: 'manual', trechos: [{ seq: 1, codigo: 'PRT1', descricao: '', postoConclui: 'Inspeção PTH', snModo: 'mesmo', estoque: 'EINTER' }] })
    expect(await ativarEstruturaAction('P')).toEqual({ ok: true })
    expect(repo.marcarAtiva).toHaveBeenCalledWith('P', 'Matheus')
  })
})

describe('importarDoCompelsAction', () => {
  it('cria rascunho só para PMO sem estrutura e com filhas; conta as sem filhas', async () => {
    repo.listarEstruturas.mockResolvedValue([{ pmo: 'JA', situacao: 'ativa', origem: 'manual', trechos: [] }])
    repo.ultimaOpNumericaPorPmo.mockResolvedValue([{ pmo: 'JA', op: '1' }, { pmo: 'PMOC14', op: '8498' }, { pmo: 'SOLO', op: '8739' }])
    compels.lerDescendentes.mockImplementation(async (n: number) =>
      n === 8498 ? [{ numero: 8499, codigo: 'PRT420', descricao: 'PARTES PTH', nivel: 2, mae: 8498, principal: 8498, status: '' }] : [])
    const r = await importarDoCompelsAction()
    expect(r).toEqual({ ok: true, criadas: 1, semFilhas: 1, falhas: 0 })
    expect(repo.salvarEstrutura).toHaveBeenCalledTimes(1)
    expect(repo.salvarEstrutura.mock.calls[0]![0]).toBe('PMOC14')
    expect(repo.salvarEstrutura.mock.calls[0]![3]).toBe('compels:8498')
  })
})

describe('importarDoCompelsAction (falhas)', () => {
  it('conta falha quando o Compels erra para uma PMO e segue com as outras', async () => {
    repo.listarEstruturas.mockResolvedValue([])
    repo.ultimaOpNumericaPorPmo.mockResolvedValue([{ pmo: 'A', op: '1' }, { pmo: 'B', op: '2' }])
    compels.lerDescendentes.mockImplementation(async (n: number) => {
      if (n === 1) throw new Error('rede')
      return [{ numero: 3, codigo: 'PRT420', descricao: '', nivel: 2, mae: 2, principal: 2, status: '' }]
    })
    expect(await importarDoCompelsAction()).toEqual({ ok: true, criadas: 1, semFilhas: 0, falhas: 1 })
  })
})

describe('salvarEstruturaAction', () => {
  const t = (codigo: string, seq = 9) => ({ seq, codigo, descricao: '', postoConclui: null, snModo: 'mesmo' as const, estoque: 'EINTER' as const })
  it('renumera o seq a partir de 1', async () => {
    expect(await salvarEstruturaAction('P', [t('PRT1', 7), t('PRT2', 3)])).toEqual({ ok: true })
    expect(repo.salvarEstrutura.mock.calls[0]![1].map((x: { seq: number }) => x.seq)).toEqual([1, 2])
  })
  it('recusa código vazio sem gravar', async () => {
    expect(await salvarEstruturaAction('P', [t('  ')])).toEqual({ ok: false, erro: 'Todo trecho precisa do código da PRT.' })
    expect(repo.salvarEstrutura).not.toHaveBeenCalled()
  })
  it('sem permissão: recusa', async () => {
    vi.mocked(podeNoModulo).mockReturnValueOnce(false)
    const r = await salvarEstruturaAction('P', [t('PRT1')])
    expect(r).toEqual({ ok: false, erro: 'Você não tem permissão para gerenciar estruturas.' })
    expect(repo.salvarEstrutura).not.toHaveBeenCalled()
    expect(getSessao).toHaveBeenCalled()
  })
})
