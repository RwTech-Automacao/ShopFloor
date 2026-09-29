import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Perfil } from '@/modules/auth/domain/perfil'
import type { LinhaFilaEstoque } from '@/modules/shopfloor/domain/estoque-pendente'
import { TETO_TENTATIVAS } from '@/modules/shopfloor/domain/estoque-pendente'

vi.mock('server-only', () => ({}))

const { getSessao, listarEstoquePendente, reenviarEstoqueAction } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  listarEstoquePendente: vi.fn(),
  // A action é mockada porque importá-la de verdade arrastaria o client de service_role para o teste
  // de tela; o comportamento dela tem teste próprio.
  reenviarEstoqueAction: vi.fn(async () => ({ ok: true as const, chave: 'x' })),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/estoque-pendente-repository', () => ({ listarEstoquePendente }))
vi.mock('@/modules/shopfloor/application/estoque-pendente-actions', () => ({ reenviarEstoqueAction }))

import EstoquePendentePage from '../page'

function perfil(perm: Record<string, boolean>): Perfil {
  return {
    id: 'p1',
    nome: 'Teste',
    permissoes: {} as Perfil['permissoes'],
    porModulo: { shopfloor: perm } as Perfil['porModulo'],
    sistema: false,
  }
}

function sessao(perm: Record<string, boolean>) {
  return { usuarioId: 'u1', nome: 'Gestor', email: 'g@x', perfil: perfil(perm) }
}

function linha(over: Partial<LinhaFilaEstoque> = {}): LinhaFilaEstoque {
  return {
    id: 'e1',
    chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/E1',
    operacao: 'entrada',
    pmo: 'PMOA01',
    op: '9100',
    posto: 'Almoxarifado',
    tipo: 'caixa',
    bipe: 'CX[1][3]9100-PMOA01',
    alvo: 'CX[1][3]9100-PMOA01',
    quantidade: 3,
    estornado: 0,
    tentativas: TETO_TENTATIVAS,
    reservadoEm: null,
    erro: 'Compels: envio ao ERP ainda não implementado',
    criadoEm: '2026-09-29T11:00:00.000Z',
    entradaId: null,
    seqChave: 1,
    ...over,
  }
}

function fila(linhas: LinhaFilaEstoque[], entradas = new Map()) {
  return { linhas, entradas, cortada: false }
}

beforeEach(() => {
  vi.clearAllMocks()
  listarEstoquePendente.mockResolvedValue(fila([linha()]))
  getSessao.mockResolvedValue(sessao({ visualizar: true, administrar: true }))
})

describe('gate da tela de estoque pendente', () => {
  it('sem sessão não vê a fila, e o banco nem é consultado', async () => {
    getSessao.mockResolvedValue(null)
    render(await EstoquePendentePage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(listarEstoquePendente).not.toHaveBeenCalled()
  })

  it('sem shopfloor:visualizar não vê a fila', async () => {
    getSessao.mockResolvedValue(sessao({ administrar: true }))
    render(await EstoquePendentePage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(listarEstoquePendente).not.toHaveBeenCalled()
  })

  it('com visualizar vê a fila, mas SEM administrar não tem botão de reenviar', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    render(await EstoquePendentePage())
    expect(screen.getByText(/Compels: envio ao ERP ainda não implementado/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reenviar/ })).toBeNull()
  })

  it('com visualizar e administrar, a linha fora da fila tem botão de reenviar', async () => {
    render(await EstoquePendentePage())
    expect(screen.getByRole('button', { name: /Reenviar/ })).toBeInTheDocument()
  })
})

describe('o que a tela diz sem contexto', () => {
  it('o aviso de que a integração ainda não existe é fixo no topo', async () => {
    render(await EstoquePendentePage())
    expect(
      screen.getByText(/A integração com o Compels ainda não foi configurada/),
    ).toBeInTheDocument()
  })

  it('o aviso aparece TAMBÉM com a fila vazia (é ele que explica o vazio)', async () => {
    listarEstoquePendente.mockResolvedValue(fila([]))
    render(await EstoquePendentePage())
    expect(
      screen.getByText(/A integração com o Compels ainda não foi configurada/),
    ).toBeInTheDocument()
    expect(screen.getByText(/Nada na fila/)).toBeInTheDocument()
  })

  it('a linha mostra o motivo do último erro e o que fazer', async () => {
    render(await EstoquePendentePage())
    expect(screen.getByText(/Compels: envio ao ERP ainda não implementado/)).toBeInTheDocument()
    expect(screen.getByText(/Gastou as 5 tentativas e saiu da fila/)).toBeInTheDocument()
    expect(screen.getByText('Fora da fila')).toBeInTheDocument()
  })

  it('a entrada parcialmente revertida mostra o SALDO, com a conta à vista', async () => {
    listarEstoquePendente.mockResolvedValue(fila([linha({ quantidade: 3, estornado: 2 })]))
    render(await EstoquePendentePage())
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/3 bipadas − 2 já estornadas/)).toBeInTheDocument()
  })

  it('o estorno retido aparece JUNTO da entrada que o segura, e o botão fica na entrada', async () => {
    const entrada = linha({ id: 'e1', tentativas: TETO_TENTATIVAS })
    const estorno = linha({
      id: 's1',
      chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/S1',
      operacao: 'estorno',
      entradaId: 'e1',
      tentativas: 0,
      erro: null,
      criadoEm: '2026-09-29T11:30:00.000Z',
    })
    listarEstoquePendente.mockResolvedValue(
      fila([estorno, entrada], new Map([['e1', { id: 'e1', chave: entrada.chave, ok: false, canceladoEm: null, tentativas: TETO_TENTATIVAS }]])),
    )
    render(await EstoquePendentePage())
    // um cabeçalho de grupo só: os dois são o mesmo bipe
    expect(screen.getAllByText(/CX\[1\]\[3\]9100-PMOA01/).length).toBeGreaterThan(0)
    expect(screen.getByText('Esperando a entrada')).toBeInTheDocument()
    expect(screen.getByText(/Reenviar NA LINHA DA ENTRADA/)).toBeInTheDocument()
    // e o Reenviar existe uma vez só — na entrada
    expect(screen.getAllByRole('button', { name: /Reenviar/ })).toHaveLength(1)
  })
})
