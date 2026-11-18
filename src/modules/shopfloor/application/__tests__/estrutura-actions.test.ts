import { beforeEach, describe, expect, it, vi } from 'vitest'

const repo = vi.hoisted(() => ({ resumoTrechosDaOp: vi.fn(), listarTrechosDaOp: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: vi.fn(async () => ({ perfil: 'admin' })) }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('../../infra/estrutura-repository', () => repo)

import { lerTrechosCompelsAction, lerTrechosDaOpAction } from '../estrutura-actions'
import { podeNoModulo } from '@/modules/auth/domain/perfil'

beforeEach(() => vi.clearAllMocks())

describe('lerTrechosCompelsAction', () => {
  it('devolve o resumo dos trechos', async () => {
    repo.resumoTrechosDaOp.mockResolvedValue([{ posto: 'Inspeção PTH', codigo: 'PRT420', compelsOp: '8499', apontadas: 1, naFila: 0, motivo: null }])
    expect(await lerTrechosCompelsAction('PMOC14', '8498')).toHaveLength(1)
  })
  it('sem permissão ou erro = vazio', async () => {
    vi.mocked(podeNoModulo).mockReturnValueOnce(false)
    expect(await lerTrechosCompelsAction('PMOC14', '8498')).toEqual([])
    repo.resumoTrechosDaOp.mockRejectedValueOnce(new Error('x'))
    expect(await lerTrechosCompelsAction('PMOC14', '8498')).toEqual([])
  })
})

describe('lerTrechosDaOpAction', () => {
  it('devolve os trechos; sem permissão ou erro = vazio', async () => {
    repo.listarTrechosDaOp.mockResolvedValueOnce([{ seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', postos: ['SPI'] }])
    expect(await lerTrechosDaOpAction('PMOC14', '8498')).toHaveLength(1)
    vi.mocked(podeNoModulo).mockReturnValueOnce(false)
    expect(await lerTrechosDaOpAction('PMOC14', '8498')).toEqual([])
    repo.listarTrechosDaOp.mockRejectedValueOnce(new Error('x'))
    expect(await lerTrechosDaOpAction('PMOC14', '8498')).toEqual([])
  })
})
