import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Perfil } from '@/modules/auth/domain/perfil'

/**
 * Caso 7 da spec: sem `recebimento: gerar_etiqueta`, a TELA e as AÇÕES recusam — e não chegam a
 * tocar o banco. Cobre também o caminho feliz da geração: a ordem da planilha, a revalidação do
 * servidor (nunca confia no cliente) e o formato do arquivo.
 */

vi.mock('server-only', () => ({}))
// `refresh()` só roda dentro de uma request de server action; no teste é um no-op.
vi.mock('next/cache', () => ({ refresh: () => {} }))

const { getSessao, resumoLegado, conferirParesLegado, emitirEtiquetasLegado, registrarLog } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  resumoLegado: vi.fn(),
  conferirParesLegado: vi.fn(),
  emitirEtiquetasLegado: vi.fn(),
  registrarLog: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/etiquetas/infra/etiqueta-legado-repository', () => ({
  resumoLegado,
  conferirParesLegado,
  emitirEtiquetasLegado,
}))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog }))

import EtiquetasLegadoPage from '../page'
import {
  conferirEtiquetasLegado,
  gerarEtiquetasLegado,
} from '@/modules/etiquetas/application/gerar-etiquetas-legado'

function sessao(permissoes: Record<string, boolean>) {
  return {
    usuarioId: 'u1',
    nome: 'Ana Gestora',
    email: 'ana@enterplak.com.br',
    perfil: {
      id: 'p1',
      nome: 'Gestor',
      permissoes: {},
      porModulo: { recebimento: permissoes },
      sistema: false,
    } as unknown as Perfil,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resumoLegado.mockResolvedValue({ totalEtiquetas: 0, totalItens: 0, ultima: null })
  conferirParesLegado.mockResolvedValue([])
  emitirEtiquetasLegado.mockResolvedValue([])
})

describe('gate da tela de etiquetas do estoque legado', () => {
  it('sem sessão, recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(null)
    render(await EtiquetasLegadoPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
    expect(resumoLegado).not.toHaveBeenCalled()
  })

  it('sem `recebimento: gerar_etiqueta`, recusa e não consulta nada', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true, importar: true }))
    render(await EtiquetasLegadoPage())
    expect(screen.getByText(/não tem permissão para gerar etiquetas/i)).toBeInTheDocument()
    expect(resumoLegado).not.toHaveBeenCalled()
  })

  it('permissão de outro módulo não abre a tela', async () => {
    getSessao.mockResolvedValue({
      ...sessao({}),
      perfil: {
        id: 'p1',
        nome: 'Produção',
        permissoes: {},
        porModulo: { shopfloor: { gerar_etiqueta: true } },
        sistema: false,
      } as unknown as Perfil,
    })
    render(await EtiquetasLegadoPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
  })

  it('com `recebimento: gerar_etiqueta`, abre e mostra o progresso do mutirão', async () => {
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true }))
    resumoLegado.mockResolvedValue({ totalEtiquetas: 37, totalItens: 12, ultima: '2026-09-24T18:30:00.000Z' })
    render(await EtiquetasLegadoPage())
    expect(screen.getByRole('heading', { name: /Etiquetas do estoque legado/i })).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })
})

describe('gate das server actions', () => {
  it('sem sessão, conferir e gerar recusam sem tocar o banco', async () => {
    getSessao.mockResolvedValue(null)
    expect(await conferirEtiquetasLegado([{ item: 'CAPA78', locacao: 'A1.C.39' }])).toEqual({
      ok: false,
      erro: 'Você não tem permissão para gerar etiquetas.',
    })
    expect(await gerarEtiquetasLegado([{ item: 'CAPA78', locacao: 'A1.C.39' }])).toEqual({
      ok: false,
      erro: 'Você não tem permissão para gerar etiquetas.',
    })
    expect(conferirParesLegado).not.toHaveBeenCalled()
    expect(emitirEtiquetasLegado).not.toHaveBeenCalled()
    expect(registrarLog).not.toHaveBeenCalled()
  })

  it('só com `visualizar` também recusa (a permissão é gerar_etiqueta)', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true }))
    expect((await gerarEtiquetasLegado([{ item: 'CAPA78', locacao: 'A1.C.39' }])).ok).toBe(false)
    expect(emitirEtiquetasLegado).not.toHaveBeenCalled()
  })

  it('permissão de outro módulo não serve', async () => {
    getSessao.mockResolvedValue({
      ...sessao({}),
      perfil: {
        id: 'p1',
        nome: 'Produção',
        permissoes: {},
        porModulo: { shopfloor: { gerar_etiqueta: true } },
        sistema: false,
      } as unknown as Perfil,
    })
    expect((await conferirEtiquetasLegado([{ item: 'CAPA78', locacao: 'A1.C.39' }])).ok).toBe(false)
    expect(conferirParesLegado).not.toHaveBeenCalled()
  })
})

describe('geração pela server action', () => {
  beforeEach(() => {
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true }))
  })

  it('normaliza os pares e manda na ordem recebida; o arquivo sai no formato de hoje', async () => {
    emitirEtiquetasLegado.mockResolvedValue([
      { ordem: 2, item: 'RESY99', sequencial: 1, codigo: 'RESY99-L0001', locacao: 'A1.C.71' },
      { ordem: 1, item: 'CAPA78', sequencial: 3, codigo: 'CAPA78-L0003', locacao: 'A1.C.39' },
    ])
    const res = await gerarEtiquetasLegado([
      { item: ' capa78 ', locacao: 'A1.C.39 - A1.C.39' },
      { item: 'resy99', locacao: 'a1.c.71 - a1.c.71' },
    ])

    expect(emitirEtiquetasLegado).toHaveBeenCalledWith([
      { item: 'CAPA78', locacao: 'A1.C.39' },
      { item: 'RESY99', locacao: 'A1.C.71' },
    ])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.csv).toBe('"CAPA78-L0003","CAPA78","01-01"\r\n"RESY99-L0001","RESY99","01-01"')
    expect(res.fileName).toMatch(/^Etiquetas_legado_\d{8}_\d{6}\.csv$/)
    expect(res.totalEtiquetas).toBe(2)
    expect(res.ignoradas).toBe(0)
    expect(registrarLog).toHaveBeenCalledWith(
      expect.objectContaining({ entidade: 'etiqueta_legado', acao: 'gerar_etiqueta' }),
    )
  })

  it('o servidor revalida: linha sem item ou com separador não chega ao banco', async () => {
    emitirEtiquetasLegado.mockResolvedValue([
      { ordem: 1, item: 'CAPA78', sequencial: 1, codigo: 'CAPA78-L0001', locacao: 'A1.C.39' },
    ])
    const res = await gerarEtiquetasLegado([
      { item: 'CAPA78', locacao: 'A1.C.39' },
      { item: '', locacao: 'A1.C.01' },
      { item: 'CAP-986', locacao: 'A1.C.02' },
    ])

    expect(emitirEtiquetasLegado).toHaveBeenCalledWith([{ item: 'CAPA78', locacao: 'A1.C.39' }])
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.ignoradas).toBe(2)
  })

  it('sem nenhuma linha válida, recusa em vez de gerar arquivo vazio', async () => {
    const res = await gerarEtiquetasLegado([{ item: '', locacao: 'A1.C.01' }])
    expect(res.ok).toBe(false)
    expect(emitirEtiquetasLegado).not.toHaveBeenCalled()
  })

  it('acima do teto de 5.000 linhas, recusa antes de tocar o banco', async () => {
    const muitas = Array.from({ length: 5001 }, (_, i) => ({ item: 'CAPA78', locacao: `A1.C.${i}` }))
    expect((await gerarEtiquetasLegado(muitas)).ok).toBe(false)
    expect((await conferirEtiquetasLegado(muitas)).ok).toBe(false)
    expect(emitirEtiquetasLegado).not.toHaveBeenCalled()
    expect(conferirParesLegado).not.toHaveBeenCalled()
  })
})
