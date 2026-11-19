import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
const getSessao = vi.fn()
const novaOpLiberada = vi.fn()
vi.mock('@/modules/auth/application/get-sessao', () => ({ getSessao: () => getSessao() }))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: () => true }))
vi.mock('@/shared/ui/sem-permissao', () => ({ SemPermissao: () => null }))
vi.mock('@/modules/shopfloor/application/liberacao-nova-op', () => ({ novaOpLiberada: (e: string) => novaOpLiberada(e) }))
vi.mock('../ordens-conteudo', () => ({ OrdensConteudo: () => null }))

import OrdensPage from '../page'
import OrdensNovaPage from '../../ordens-nova/page'
import { OrdensConteudo } from '../ordens-conteudo'
import { SemPermissao } from '@/shared/ui/sem-permissao'

beforeEach(() => {
  getSessao.mockResolvedValue({ email: 'a@x', perfil: {} })
})

describe('páginas de ordens', () => {
  it('a antiga renderiza o cadastro antigo (sem href) mesmo para liberado', async () => {
    novaOpLiberada.mockReturnValue(true)
    const el = await OrdensPage()
    expect(el.type).toBe(OrdensConteudo)
    expect(el.props.novaOpHref).toBeUndefined()
  })
  it('a nova recusa quem não está liberado', async () => {
    novaOpLiberada.mockReturnValue(false)
    const el = await OrdensNovaPage()
    expect(el.type).toBe(SemPermissao)
  })
  it('a nova, liberado: Nova OP aponta para /shopfloor/ordens/nova', async () => {
    novaOpLiberada.mockReturnValue(true)
    const el = await OrdensNovaPage()
    expect(el.type).toBe(OrdensConteudo)
    expect(el.props.novaOpHref).toBe('/shopfloor/ordens/nova')
    expect(el.props.editarTrechosBase).toBe('/shopfloor/ordens-nova')
  })
})
