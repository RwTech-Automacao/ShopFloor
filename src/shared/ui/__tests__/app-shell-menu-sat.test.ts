import { describe, expect, it, vi } from 'vitest'
import { BellRing, ClipboardList } from 'lucide-react'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/actions', () => ({ sair: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

import { SAT } from '../app-shell'

describe('menu do SAT', () => {
  it('"Alertas" vem logo depois de "Equipamentos"', () => {
    const chaves = SAT.map((i) => i.chave)
    expect(chaves.indexOf('sat-alertas')).toBe(chaves.indexOf('sat-equipamentos') + 1)
  })
  it('aponta para /sat/alertas, com sat.administrar e o sino', () => {
    const item = SAT.find((i) => i.chave === 'sat-alertas')!
    expect(item).toMatchObject({ rotulo: 'Alertas', href: '/sat/alertas', modulo: 'sat', perm: 'administrar' })
    expect(item.icone).toBe(BellRing)
  })
  it('"Ordens de serviço" vem logo depois da entrada, com sat.visualizar', () => {
    const chaves = SAT.map((i) => i.chave)
    expect(chaves.indexOf('sat-ordens')).toBe(chaves.indexOf('sat-entrada') + 1)
    const item = SAT.find((i) => i.chave === 'sat-ordens')!
    expect(item).toMatchObject({ rotulo: 'Ordens de serviço', href: '/sat/ordens', modulo: 'sat', perm: 'visualizar' })
    expect(item.icone).toBe(ClipboardList)
  })
})
