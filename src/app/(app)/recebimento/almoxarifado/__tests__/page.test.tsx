// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'

vi.mock('server-only', () => ({}))

const { getSessao, listarOrdensParaLancamento, mapaPostoPerfil } = vi.hoisted(() => ({
  getSessao: vi.fn(),
  listarOrdensParaLancamento: vi.fn(),
  mapaPostoPerfil: vi.fn(),
}))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao }))
vi.mock('@/modules/shopfloor/infra/lancamento-repository', () => ({ listarOrdensParaLancamento }))
vi.mock('@/modules/shopfloor/infra/postos-repository', () => ({
  mapaPostoPerfil,
  mapaPostoColetivo: vi.fn(async () => ({})),
  mapaPostoRotaDestino: vi.fn(async () => new Set<string>()),
}))
vi.mock('@/app/(app)/shopfloor/operar/lancamento/lancamento-form', () => ({ LancamentoForm: () => null }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => null }))

import { SemPermissao } from '@/shared/ui/sem-permissao'
import AlmoxarifadoPage from '../page'

const perfil = (porModulo: Record<string, Record<string, boolean>>) => ({ porModulo })
const COM_TUDO = perfil({ recebimento: { lancar: true }, shopfloor: { visualizar: true } })

const ordem = (op: string, postos: string[]) => ({ cliente: 'C', pmo: 'PMO1', op, postos })

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
  listarOrdensParaLancamento.mockResolvedValue([ordem('1', ['Embalagem', 'Almoxarifado']), ordem('2', ['Embalagem'])])
})

describe('/recebimento/almoxarifado', () => {
  it('sem recebimento.lancar: sem permissão, e não lê nada', async () => {
    getSessao.mockResolvedValue({ nome: 'Ana', perfil: perfil({ shopfloor: { lancar: true, visualizar: true } }) })
    const el = (await AlmoxarifadoPage()) as ReactElement<{ descricao: string }>
    expect(el.type).toBe(SemPermissao)
    expect(el.props.descricao).toContain('dar entrada no Almoxarifado')
    expect(listarOrdensParaLancamento).not.toHaveBeenCalled()
  })

  it('sem sessão: sem permissão', async () => {
    getSessao.mockResolvedValue(null)
    expect(((await AlmoxarifadoPage()) as ReactElement).type).toBe(SemPermissao)
    expect(listarOrdensParaLancamento).not.toHaveBeenCalled()
  })

  it('com lançar do Recebimento mas sem visualizar do ShopFloor: avisa e não lê', async () => {
    getSessao.mockResolvedValue({ nome: 'Ana', perfil: perfil({ recebimento: { lancar: true } }) })
    const el = (await AlmoxarifadoPage()) as ReactElement<{ descricao: string }>
    expect(el.type).toBe(SemPermissao)
    expect(el.props.descricao).toContain('visualizar')
    expect(listarOrdensParaLancamento).not.toHaveBeenCalled()
  })

  it('monta o formulário em modo Almoxarifado: posto fixo, colaborador = usuário logado, só OPs com o posto na rota', async () => {
    getSessao.mockResolvedValue({ nome: 'Ana Souza', perfil: COM_TUDO })
    const el = await AlmoxarifadoPage()
    const form = achar(el, 'LancamentoForm')
    expect(form).not.toBeNull()
    const props = form!.props as { ordens: { op: string }[]; modoAlmoxarifado: { colaborador: string; posto: string }; defeitos: unknown[] }
    expect(props.modoAlmoxarifado).toEqual({ colaborador: 'Ana Souza', posto: 'Almoxarifado' })
    expect(props.ordens.map((o) => o.op)).toEqual(['1'])
    expect(props.defeitos).toEqual([])
  })

  it('sem posto de perfil Almoxarifado cadastrado: mensagem clara, sem formulário', async () => {
    mapaPostoPerfil.mockResolvedValue({ Embalagem: { recurso: 'caixa' } })
    getSessao.mockResolvedValue({ nome: 'Ana', perfil: COM_TUDO })
    const el = await AlmoxarifadoPage()
    expect(achar(el, 'LancamentoForm')).toBeNull()
  })
})
