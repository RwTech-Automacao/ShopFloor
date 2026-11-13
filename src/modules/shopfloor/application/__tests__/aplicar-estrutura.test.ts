import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({ copiarParaOp: vi.fn(), gravarFilhas: vi.fn(), trechosDaOp: vi.fn() }))
const compels = vi.hoisted(() => ({ lerDescendentes: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('../../infra/estrutura-repository', () => repo)
vi.mock('@/modules/compels/infra/cliente', () => ({ ClienteCompels: vi.fn(function () { return compels }) }))
vi.mock('@/modules/compels/infra/config', () => ({ configDoAmbiente: vi.fn(() => ({})) }))

import { aplicarEstruturaNaOp } from '../aplicar-estrutura'

const ROTA = ['Inspeção AOI TOP', 'Montagem PTH', 'Inspeção PTH', 'Teste', 'Almoxarifado']
const no = (numero: number, codigo: string) => ({ numero, codigo, descricao: '', nivel: 3, mae: 8499, principal: 8498, status: '' })
const CRIA = { criacao: true }
const EDIT = { criacao: false }
beforeEach(() => { vi.clearAllMocks(); repo.trechosDaOp.mockResolvedValue([]) })

describe('aplicarEstruturaNaOp: criação (OP sem trechos)', () => {
  it('PMO sem estrutura ativa: não copia nada e não avisa', async () => {
    repo.copiarParaOp.mockResolvedValue([])
    expect(await aplicarEstruturaNaOp('id', 'P', '1', ROTA, CRIA)).toBeNull()
    expect(compels.lerDescendentes).not.toHaveBeenCalled()
  })
  it('copia, casa as filhas e avisa o que não achou (singular)', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }, { seq: 2, codigo: 'PRT420' }])
    compels.lerDescendentes.mockResolvedValue([no(8500, 'PRT410')])
    const aviso = await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA, CRIA)
    expect(repo.gravarFilhas).toHaveBeenCalledWith('id', new Map([[1, 8500], [2, null]]))
    expect(aviso).toBe('PRT420 não foi encontrada no Compels abaixo da OP 8498: esse trecho não será apontado até a OP ser salva de novo.')
  })
  it('plural quando falta mais de uma', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }, { seq: 2, codigo: 'PRT420' }])
    compels.lerDescendentes.mockResolvedValue([])
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA, CRIA)).toBe(
      'PRT410, PRT420 não foram encontradas no Compels abaixo da OP 8498: esses trechos não serão apontados até a OP ser salva de novo.')
  })
  it('Compels fora do ar: a OP segue, com aviso', async () => {
    repo.copiarParaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410' }])
    compels.lerDescendentes.mockRejectedValue(new Error('rede'))
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA, CRIA)).toBe(
      'Não foi possível consultar o Compels agora: as OPs filhas serão procuradas quando a OP for salva de novo.')
  })
})

describe('aplicarEstruturaNaOp: edição (OP que já tem trechos)', () => {
  it('não copia de novo e só procura a filha dos trechos sem OP filha', async () => {
    repo.trechosDaOp.mockResolvedValue([
      { seq: 1, codigo: 'PRT410', compelsOp: '8500' },
      { seq: 2, codigo: 'PRT420', compelsOp: null },
    ])
    compels.lerDescendentes.mockResolvedValue([no(8499, 'PRT420')])
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA, EDIT)).toBeNull()
    expect(repo.copiarParaOp).not.toHaveBeenCalled()
    expect(repo.gravarFilhas).toHaveBeenCalledWith('id', new Map([[2, 8499]]))
  })
  it('tudo já casado: nem consulta o Compels (receita em rascunho ou alterada não mexe na OP)', async () => {
    repo.trechosDaOp.mockResolvedValue([{ seq: 1, codigo: 'PRT410', compelsOp: '8500' }])
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA, EDIT)).toBeNull()
    expect(repo.copiarParaOp).not.toHaveBeenCalled()
    expect(compels.lerDescendentes).not.toHaveBeenCalled()
    expect(repo.gravarFilhas).not.toHaveBeenCalled()
  })
  it('edição de OP sem trechos: não copia e não chama o Compels', async () => {
    repo.trechosDaOp.mockResolvedValue([])
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '8498', ROTA, EDIT)).toBeNull()
    expect(repo.copiarParaOp).not.toHaveBeenCalled()
    expect(compels.lerDescendentes).not.toHaveBeenCalled()
  })
  it('edição que mudou o número da OP refaz o casamento de todos os trechos', async () => {
    repo.trechosDaOp.mockResolvedValue([
      { seq: 1, codigo: 'PRT410', compelsOp: '8500' },
      { seq: 2, codigo: 'PRT420', compelsOp: '8499' },
    ])
    compels.lerDescendentes.mockResolvedValue([no(9501, 'PRT410'), no(9502, 'PRT420')])
    expect(await aplicarEstruturaNaOp('id', 'PMOC14', '9500', ROTA, { criacao: false, refazerTodas: true })).toBeNull()
    expect(repo.copiarParaOp).not.toHaveBeenCalled()
    expect(repo.gravarFilhas).toHaveBeenCalledWith('id', new Map([[1, 9501], [2, 9502]]))
  })
})
