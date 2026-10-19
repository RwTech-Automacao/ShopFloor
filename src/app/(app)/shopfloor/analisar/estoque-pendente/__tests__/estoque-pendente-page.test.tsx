import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
    adiadoAte: null,
    erro: 'Compels: envio ao ERP ainda não implementado',
    criadoEm: '2026-09-29T11:00:00.000Z',
    entradaId: null,
    seqChave: 1,
    ...over,
  }
}

function fila(linhas: LinhaFilaEstoque[], entradas = new Map(), cortada = false) {
  return { linhas, entradas, cortada }
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
  const NAO_CONFIGURADA = /A integração com o Compels não está configurada neste ambiente/
  const CONFIGURADA = /Estas são as entradas que ainda não chegaram ao Compels/

  afterEach(() => { vi.unstubAllEnvs() })

  it('sem o login do ezpointweb no servidor, o aviso fixo diz que a integração não está configurada', async () => {
    vi.stubEnv('COMPELS_EZPOINT_USUARIO', '')
    vi.stubEnv('COMPELS_EZPOINT_SENHA', '')
    render(await EstoquePendentePage())
    expect(screen.getByText(NAO_CONFIGURADA)).toBeInTheDocument()
    expect(screen.queryByText(CONFIGURADA)).not.toBeInTheDocument()
  })

  it('com a integração configurada, o aviso explica o que a tela mostra (e que estorno é manual)', async () => {
    vi.stubEnv('COMPELS_EZPOINT_USUARIO', 'u')
    vi.stubEnv('COMPELS_EZPOINT_SENHA', 's')
    render(await EstoquePendentePage())
    expect(screen.getByText(CONFIGURADA)).toBeInTheDocument()
    expect(screen.getByText(/Estornos ainda são feitos à mão no ERP/)).toBeInTheDocument()
    expect(screen.queryByText(NAO_CONFIGURADA)).not.toBeInTheDocument()
  })

  it('o aviso aparece TAMBÉM com a fila vazia (é ele que explica o vazio)', async () => {
    vi.stubEnv('COMPELS_EZPOINT_USUARIO', '')
    vi.stubEnv('COMPELS_EZPOINT_SENHA', '')
    listarEstoquePendente.mockResolvedValue(fila([]))
    render(await EstoquePendentePage())
    expect(screen.getByText(NAO_CONFIGURADA)).toBeInTheDocument()
    // O resumo do topo e o corpo da tabela dizem a mesma coisa, e nenhum dos dois afirma entrega.
    expect(screen.getAllByText(/Nenhuma movimentação esperando na fila/)).toHaveLength(2)
  })

  it('nenhum texto AFIRMA que algo chegou ao ERP — com o envio inexistente, nada chegou', async () => {
    listarEstoquePendente.mockResolvedValue(fila([]))
    render(await EstoquePendentePage())
    expect(screen.queryByText(/já chegou ao ERP/)).toBeNull()
    expect(screen.queryByText(/já chegou ao Compels/)).toBeNull()
  })

  it('a coluna da data é neutra: no estorno o `criado_em` é a hora do CANCELAMENTO, não do bipe', async () => {
    render(await EstoquePendentePage())
    expect(screen.getByText('Entrou na fila')).toBeInTheDocument()
    expect(screen.queryByText('Bipado em')).toBeNull()
  })

  it('o resumo separa entradas de saídas: somar as duas soma sentidos opostos', async () => {
    const entrada = linha({ id: 'e1', quantidade: 3, estornado: 3 })
    const estorno = linha({
      id: 's1',
      chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/S1',
      operacao: 'estorno',
      entradaId: 'e1',
      quantidade: 3,
      tentativas: 0,
      erro: null,
    })
    listarEstoquePendente.mockResolvedValue(
      fila([entrada, estorno], new Map([['e1', { id: 'e1', chave: entrada.chave, ok: false, canceladoEm: null, tentativas: TETO_TENTATIVAS }]])),
    )
    render(await EstoquePendentePage())
    // A entrada foi revertida por inteiro: 0 peça a entrar, 3 a sair. A soma antiga dizia "3 peças".
    expect(screen.getByText(/1 entrada \(0 peças\) · 1 saída \(3 peças\)/)).toBeInTheDocument()
  })

  it('a lista cortada avisa que as que precisam de alguém vêm primeiro', async () => {
    listarEstoquePendente.mockResolvedValue(fila([linha()], new Map(), true))
    render(await EstoquePendentePage())
    expect(screen.getByText(/precisam de alguém vêm primeiro/)).toBeInTheDocument()
  })

  it('a frase "Mostrando" diz a verdade quando a conclusão do par passa do limite', async () => {
    // 200 linhas do corte + 1 entrada que o repositório puxou só para completar um par: são 201 na
    // tela, e dizer "Mostrando 200" seria falso.
    const muitas = Array.from({ length: 201 }, (_, i) =>
      linha({
        id: `e${i}`,
        chave: `ALMOX/PMOA01/9100/Almoxarifado/CX[${i}][3]9100-PMOA01/E1`,
        bipe: `CX[${i}][3]9100-PMOA01`,
        alvo: `CX[${i}][3]9100-PMOA01`,
        seqChave: i,
      }),
    )
    listarEstoquePendente.mockResolvedValue(fila(muitas, new Map(), true))
    render(await EstoquePendentePage())
    expect(screen.getAllByText(/Compels: envio ao ERP ainda não implementado/)).toHaveLength(201)
    expect(screen.queryByText(/Mostrando 200 —/)).toBeNull()
    expect(
      screen.getByText(/Mostrando as 200 mais acionáveis, mais 1 para completar os pares/),
    ).toBeInTheDocument()
  })

  it('sem pares a mais, a frase "Mostrando" usa o número real de linhas', async () => {
    listarEstoquePendente.mockResolvedValue(fila([linha()], new Map(), true))
    render(await EstoquePendentePage())
    expect(screen.getByText(/Mostrando 1 —/)).toBeInTheDocument()
  })

  it('o estorno retido diz que NÃO falhou, e não "ainda não foi tentada"', async () => {
    const entrada = linha({ id: 'e1', tentativas: TETO_TENTATIVAS })
    const estorno = linha({
      id: 's1',
      chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/S1',
      operacao: 'estorno',
      entradaId: 'e1',
      tentativas: 0,
      erro: null,
    })
    listarEstoquePendente.mockResolvedValue(
      fila([estorno, entrada], new Map([['e1', { id: 'e1', chave: entrada.chave, ok: false, canceladoEm: null, tentativas: TETO_TENTATIVAS }]])),
    )
    render(await EstoquePendentePage())
    expect(screen.getByText(/está retida de propósito, esperando a entrada/)).toBeInTheDocument()
    expect(screen.queryByText(/ainda não foi tentada/)).toBeNull()
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
