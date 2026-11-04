import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

const { listarEstoquePendente } = vi.hoisted(() => ({ listarEstoquePendente: vi.fn() }))
vi.mock('@/modules/shopfloor/infra/estoque-pendente-repository', () => ({ listarEstoquePendente }))

import type { LinhaFilaEstoque } from '@/modules/shopfloor/domain/estoque-pendente'
import { EnvioCompels } from '../envio-compels'

const linha = (extra: Partial<LinhaFilaEstoque> = {}): LinhaFilaEstoque => ({
  id: 'a', chave: 'k', operacao: 'entrada', pmo: 'PMOF52_F', op: '8682_F', posto: 'Almoxarifado',
  tipo: 'lote', bipe: 'LOTE[x][6]', alvo: 'LOTE[x][6]', quantidade: 6, estornado: 0, tentativas: 0,
  reservadoEm: null, erro: null, adiadoAte: null, criadoEm: '2026-11-04T18:33:00Z', entradaId: null, seqChave: 1,
  ...extra,
})

async function montar() {
  render(await EnvioCompels())
}

beforeEach(() => vi.clearAllMocks())

describe('EnvioCompels', () => {
  it('sem nada na fila: não mostra o quadro', async () => {
    listarEstoquePendente.mockResolvedValue({ linhas: [], entradas: new Map(), cortada: false })
    await montar()
    expect(screen.queryByLabelText('Envio ao Compels')).toBeNull()
  })

  it('espera por OP aberta no Compels: mostra OP, peças, o motivo e o que fazer', async () => {
    const adiado = new Date(Date.now() + 5 * 60_000).toISOString()
    listarEstoquePendente.mockResolvedValue({
      linhas: [linha({ erro: 'Este registro está sendo acessado pelo usuário qualidade@enterplak.com.br !', adiadoAte: adiado })],
      entradas: new Map(),
      cortada: false,
    })
    await montar()
    expect(screen.getByText(/ainda não chegou ao Compels/)).toBeInTheDocument()
    expect(screen.getByText('OP 8682_F')).toBeInTheDocument()
    expect(screen.getByText(/PMOF52_F · 6 peças/)).toBeInTheDocument()
    expect(screen.getByText('Esperando o Compels')).toBeInTheDocument()
    expect(screen.getByText(/sendo acessado pelo usuário qualidade@enterplak.com.br/)).toBeInTheDocument()
    expect(screen.getByText(/Nada foi gravado no Compels\. A integração tenta de novo sozinha, por volta das \d{2}:\d{2}\./)).toBeInTheDocument()
    expect(screen.queryByText(/motivo está ao lado/)).toBeNull()
    expect(screen.getByRole('link', { name: 'Ver a fila completa' })).toHaveAttribute('href', '/shopfloor/analisar/estoque-pendente')
  })

  it('linha ainda não tentada: frase simples, sem explicação do cron', async () => {
    listarEstoquePendente.mockResolvedValue({ linhas: [linha()], entradas: new Map(), cortada: false })
    await montar()
    expect(screen.getByText('Na fila')).toBeInTheDocument()
    expect(screen.getByText('Aguardando a próxima rodada de envio ao Compels.')).toBeInTheDocument()
    expect(screen.queryByText(/já estiver armado/)).toBeNull()
  })

  it('linha que gastou as tentativas: selo "Fora da fila"', async () => {
    listarEstoquePendente.mockResolvedValue({
      linhas: [linha({ tentativas: 5, erro: 'O Compels recusou' })],
      entradas: new Map(),
      cortada: false,
    })
    await montar()
    expect(screen.getByText('Fora da fila')).toBeInTheDocument()
    expect(screen.getByText(/O Compels recusou/)).toBeInTheDocument()
  })

  it('falha ao ler a fila: não derruba a página (nenhum quadro)', async () => {
    listarEstoquePendente.mockRejectedValue(new Error('banco fora'))
    await montar()
    expect(screen.queryByLabelText('Envio ao Compels')).toBeNull()
  })
})
