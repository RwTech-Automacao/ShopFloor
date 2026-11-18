import { describe, expect, it, vi } from 'vitest'
import { FilePlus2, FileStack } from 'lucide-react'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/actions', () => ({ sair: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

import { SHOPFLOOR, itemAtivo, itensShopfloor } from '../app-shell'

const antigo = SHOPFLOOR.find((i) => i.chave === 'op-ordens')!
const nova = SHOPFLOOR.find((i) => i.chave === 'op-ordens-nova')!

describe('menu: Ordens de Produção (nova)', () => {
  it('fica logo abaixo da antiga, com ícone próprio e shopfloor.administrar', () => {
    const chaves = SHOPFLOOR.map((i) => i.chave)
    expect(chaves.indexOf('op-ordens-nova')).toBe(chaves.indexOf('op-ordens') + 1)
    expect(nova).toMatchObject({ rotulo: 'Ordens de Produção (nova)', href: '/shopfloor/ordens-nova', modulo: 'shopfloor', perm: 'administrar' })
    expect(nova.icone).toBe(FilePlus2)
    expect(antigo.icone).toBe(FileStack)
  })
  it('o item (nova) só aparece para os liberados; a antiga sempre', () => {
    const chaves = (lib: boolean) => itensShopfloor(() => true, lib).map((i) => i.chave)
    expect(chaves(true)).toContain('op-ordens-nova')
    expect(chaves(false)).not.toContain('op-ordens-nova')
    expect(chaves(false)).toContain('op-ordens')
  })
  it('destaque: nunca os dois ao mesmo tempo', () => {
    for (const [path, a, n] of [
      ['/shopfloor/ordens', true, false],
      ['/shopfloor/ordens-nova', false, true],
      ['/shopfloor/ordens/nova', false, true],
    ] as const) {
      expect([path, itemAtivo(path, antigo), itemAtivo(path, nova)]).toEqual([path, a, n])
    }
  })
})
