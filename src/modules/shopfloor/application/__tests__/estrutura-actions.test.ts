import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({
  listarEstruturas: vi.fn(), salvarEstrutura: vi.fn(), marcarAtiva: vi.fn(), rotaDeReferencia: vi.fn(),
  ultimaOpNumericaPorPmo: vi.fn(), copiarParaOp: vi.fn(), gravarFilhas: vi.fn(), estruturaDaPmo: vi.fn(),
}))
const compels = vi.hoisted(() => ({ lerDescendentes: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: 'admin', nome: 'Matheus', email: 'm@x' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn() }))
vi.mock('../../infra/estrutura-repository', () => repo)
vi.mock('../../infra/postos-repository', () => ({ mapaPostoPerfil: vi.fn(async () => ({ Almoxarifado: { recurso: 'almoxarifado' } })) }))
vi.mock('@/modules/compels/infra/cliente', () => ({ ClienteCompels: vi.fn(function () { return compels }) }))
vi.mock('@/modules/compels/infra/config', () => ({ configDoAmbiente: vi.fn(() => ({})), ConfiguracaoIncompleta: class extends Error {} }))

import { aplicarEstruturaNaOp, ativarEstruturaAction, importarDoCompelsAction, lerDoCompelsAction } from '../estrutura-actions'

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

describe('aplicarEstruturaNaOp', () => {
  it('PMO sem estrutura ativa: não copia nada e não avisa', async () => {
    repo.copiarParaOp.mockResolvedValue([])
    expect(await aplicarEstruturaNaOp('id', 'P', '1', ROTA)).toBeNull()
    expect(compels.lerDescendentes).not.toHaveBeenCalled()
  })
  it('copia, casa as filhas e avisa o que não achou', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }, { seq: 2, codigo: 'PRT420' }])
    compels.lerDescendentes.mockResolvedValue([{ numero: 8500, codigo: 'PRT410', descricao: '', nivel: 3, mae: 8499, principal: 8498, status: '' }])
    const aviso = await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA)
    expect(repo.gravarFilhas).toHaveBeenCalledWith('id', new Map([[1, 8500], [2, null]]))
    expect(aviso).toBe('PRT420 não foi encontrada no Compels abaixo da OP 8498: esse trecho não será apontado até a OP ser salva de novo.')
  })
  it('Compels fora do ar: a OP segue, com aviso', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }])
    compels.lerDescendentes.mockRejectedValue(new Error('rede'))
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA)).toBe(
      'Não foi possível consultar o Compels agora: as OPs filhas serão procuradas quando a OP for salva de novo.')
  })
})
