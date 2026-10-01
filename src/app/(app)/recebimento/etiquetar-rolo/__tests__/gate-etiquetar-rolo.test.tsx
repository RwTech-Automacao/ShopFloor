import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { Perfil } from '@/modules/auth/domain/perfil'

/**
 * O gate da tela: a etiqueta do inventário rotativo é a mesma permissão de todas as outras
 * (`recebimento: gerar_etiqueta`), e sem ela a tela não abre. As ações têm gate próprio no banco.
 *
 * E exige TAMBÉM `visualizar`: a policy de leitura da 0126 pede essa permissão, e RLS negando um
 * `select` devolve zero linhas em vez de erro — o perfil que só gera etiqueta etiquetaria dezenas
 * de rolos numa tela que diz "nada esperando impressão" e depois não conseguiria baixar o arquivo,
 * com os números já queimados. É melhor não abrir.
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
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true, visualizar: true }, 'shopfloor'))
    render(await EtiquetarRoloPage())
    expect(screen.getByText('Acesso restrito')).toBeInTheDocument()
  })

  it('com `gerar_etiqueta` e sem `visualizar`, recusa e diz que precisa das duas', async () => {
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true }))
    render(await EtiquetarRoloPage())
    expect(screen.getByText(/poder visualizar o Recebimento/i)).toBeInTheDocument()
  })

  it('com as duas permissões, abre', async () => {
    getSessao.mockResolvedValue(sessao({ gerar_etiqueta: true, visualizar: true }))
    render(await EtiquetarRoloPage())
    expect(screen.getByRole('heading', { name: 'Etiquetar rolo' })).toBeInTheDocument()
  })
})
