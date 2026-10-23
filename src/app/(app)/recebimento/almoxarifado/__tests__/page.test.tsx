// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('server-only', () => ({}))

const { getSessao, mapaPostoPerfil } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  mapaPostoPerfil: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({ mapaPostoPerfil }))
vi.mock('../almoxarifado-tela', () => ({ AlmoxarifadoTela: function AlmoxarifadoTela() { return null } }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => null }))

import { SemPermissao } from '@/shared/ui/sem-permissao'
import AlmoxarifadoPage from '../page'

const perfil = (porModulo: Record<string, Record<string, boolean>>) => ({ porModulo })
const COM_TUDO = perfil({ recebimento: { lancar: true }, shopfloor: { visualizar: true } })

function achar(el: unknown, tipo: string): ReactElement | null {
  if (!el || typeof el !== 'object') return null
  const e = el as ReactElement & { type?: { name?: string } | string; props?: { children?: unknown } }
  if (typeof e.type === 'function' && e.type.name === tipo) return e
  const filhos = ([] as unknown[]).concat(e.props?.children ?? [])
  for (const f of filhos) { const r = achar(f, tipo); if (r) return r }
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  mapaPostoPerfil.mockResolvedValue({ Almoxarifado: { recurso: 'almoxarifado' }, Embalagem: { recurso: 'caixa' } })
})

describe('/recebimento/almoxarifado', () => {
  it('sem recebimento.lancar: sem permissão, e não lê nada', async () => {
    getSessao.mockResolvedValue({ nome: 'Ana', perfil: perfil({ shopfloor: { lancar: true, visualizar: true } }) })
    const el = (await AlmoxarifadoPage()) as ReactElement<{ descricao: string }>
    expect(el.type).toBe(SemPermissao)
    expect(el.props.descricao).toContain('dar entrada no Almoxarifado')
    expect(mapaPostoPerfil).not.toHaveBeenCalled()
  })

  it('sem sessão: sem permissão', async () => {
    getSessao.mockResolvedValue(null)
    expect(((await AlmoxarifadoPage()) as ReactElement).type).toBe(SemPermissao)
    expect(mapaPostoPerfil).not.toHaveBeenCalled()
  })

  it('com lançar do Recebimento mas sem visualizar do ShopFloor: avisa e não lê', async () => {
    getSessao.mockResolvedValue({ nome: 'Ana', perfil: perfil({ recebimento: { lancar: true } }) })
    const el = (await AlmoxarifadoPage()) as ReactElement<{ descricao: string }>
    expect(el.type).toBe(SemPermissao)
    expect(el.props.descricao).toContain('visualizar')
    expect(mapaPostoPerfil).not.toHaveBeenCalled()
  })

  it('monta a tela de cartões: posto achado pelo perfil, colaborador = usuário logado', async () => {
    getSessao.mockResolvedValue({ nome: 'Ana Souza', perfil: COM_TUDO })
    const el = await AlmoxarifadoPage()
    const tela = achar(el, 'AlmoxarifadoTela')
    expect(tela).not.toBeNull()
    expect(tela!.props).toEqual({ colaborador: 'Ana Souza', posto: 'Almoxarifado' })
  })

  it('sem posto de perfil Almoxarifado cadastrado: mensagem clara, sem a tela', async () => {
    mapaPostoPerfil.mockResolvedValue({ Embalagem: { recurso: 'caixa' } })
    getSessao.mockResolvedValue({ nome: 'Ana', perfil: COM_TUDO })
    const el = await AlmoxarifadoPage()
    expect(achar(el, 'AlmoxarifadoTela')).toBeNull()
  })
})
