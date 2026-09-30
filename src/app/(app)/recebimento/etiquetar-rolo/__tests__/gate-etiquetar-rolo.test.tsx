import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Perfil } from '@/modules/auth/domain/perfil'

/**
 * O gate da tela: a etiqueta do inventário rotativo é a mesma permissão de todas as outras
 * (`recebimento: gerar_etiqueta`), e sem ela a tela não abre. As ações têm gate próprio no banco.
 */

vi.mock('server-only', () => ({}))

const { getSessao } = vi.hoisted(() => ({ getSessao: vi.fn() }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))

import EtiquetarRoloPage from '../page'

function sessao(permissoes: Record<string, boolean>, modulo = 'recebimento') {
  return {
    usuarioId: 'u1',
    nome: 'Ana Almoxarife',
    email: 'ana@enterplak.com.br',
    perfil: {
      id: 'p1',
      nome: 'Almoxarifado',
      permissoes: {},
      porModulo: { [modulo]: permissoes },
      sistema: false,
    } as unknown as Perfil,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('gate da tela de etiquetar rolo', () => {
  it('sem sessão, recusa', async () => {
    getSessao.mockResolvedValue(null)
    render(await EtiquetarRoloPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
  })

  it('sem `recebimento: gerar_etiqueta`, recusa', async () => {
    getSessao.mockResolvedValue(sessao({ visualizar: true, importar: true }))
    render(await EtiquetarRoloPage())
    expect(screen.getByText(/não tem permissão para gerar etiquetas/i)).toBeInTheDocument()
  })

  it('a permissão de outro módulo não abre a tela', async () => {
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true }, 'shopfloor'))
    render(await EtiquetarRoloPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
  })

  it('com a permissão, abre', async () => {
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true }))
    render(await EtiquetarRoloPage())
    expect(screen.getByRole('heading', { name: 'Etiquetar rolo' })).toBeInTheDocument()
  })
})
