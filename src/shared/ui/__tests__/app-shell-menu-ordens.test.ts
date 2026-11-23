import { describe, expect, it, vi } from 'vitest'
import { FileStack } from 'lucide-react'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/actions', () => ({ sair: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

import { SHOPFLOOR, itemAtivo, itensShopfloor } from '../app-shell'

const ordens = SHOPFLOOR.find((i) => i.chave === 'op-ordens')!

describe('menu: Ordens de Produção (uma tela só)', () => {
  it('há um item só, que leva à tela nova, com shopfloor.administrar', () => {
    expect(SHOPFLOOR.filter((i) => i.rotulo.startsWith('Ordens de Produção'))).toHaveLength(1)
    expect(SHOPFLOOR.find((i) => i.chave === 'op-ordens-nova')).toBeUndefined()
    expect(ordens).toMatchObject({ rotulo: 'Ordens de Produção', href: '/shopfloor/ordens-nova', modulo: 'shopfloor', perm: 'administrar' })
    expect(ordens.icone).toBe(FileStack)
  })
  it('aparece para qualquer perfil que passe no filtro de permissão, sem trava por e-mail', () => {
    expect(itensShopfloor(() => true).map((i) => i.chave)).toContain('op-ordens')
    expect(itensShopfloor(() => false).map((i) => i.chave)).not.toContain('op-ordens')
  })
  it('destaque: a lista, o cadastro em passos e a edição com trechos', () => {
    for (const [path, ativo] of [
      ['/shopfloor/ordens-nova', true],
      ['/shopfloor/ordens-nova/6f1c0e52-0000-4000-8000-000000000000', true],
      ['/shopfloor/ordens/nova', true],
      ['/shopfloor/fluxo', false],
    ] as const) {
      expect([path, itemAtivo(path, ordens)]).toEqual([path, ativo])
    }
  })
})
