import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const getSessao = vi.fn()
const podeNoModulo = vi.fn()
const redirect = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: (u: string) => redirect(u) }))
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: () => getSessao() }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: (...a: unknown[]) => podeNoModulo(...a) }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => null }))
vi.mock('../ordens-conteudo', () => ({ OrdensConteudo: () => null }))

import OrdensPage from '../page'
import OrdensNovaPage from '../../ordens-nova/page'
import { OrdensConteudo } from '../ordens-conteudo'
import { SemPermissao } from '@/shared/ui/sem-permissao'

beforeEach(() => {
  vi.clearAllMocks()
  getSessao.mockResolvedValue({ email: 'a@x', perfil: {} })
  podeNoModulo.mockReturnValue(true)
})

describe('páginas de ordens', () => {
  it('a rota antiga redireciona para a tela nova', () => {
    expect(() => OrdensPage()).toThrow('REDIRECT:/shopfloor/ordens-nova')
    expect(redirect).toHaveBeenCalledWith('/shopfloor/ordens-nova')
  })
  it('a nova recusa quem não administra o ShopFloor', async () => {
    podeNoModulo.mockReturnValue(false)
    expect((await OrdensNovaPage()).type).toBe(SemPermissao)
    getSessao.mockResolvedValue(null)
    expect((await OrdensNovaPage()).type).toBe(SemPermissao)
  })
  it('a nova abre para todo administrador, sem olhar o e-mail', async () => {
    getSessao.mockResolvedValue({ email: 'qualquer@x', perfil: {} })
    const el = await OrdensNovaPage()
    expect(el.type).toBe(OrdensConteudo)
    expect(el.props.editarTrechosBase).toBe('/shopfloor/ordens-nova')
    expect(podeNoModulo).toHaveBeenCalledWith({}, 'shopfloor', 'administrar')
  })
})
