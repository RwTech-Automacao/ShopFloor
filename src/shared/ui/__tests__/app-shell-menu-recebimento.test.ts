import { describe, expect, it, vi } from 'vitest'
import { ChartColumn } from 'lucide-react'

// O app-shell importa a server action de sair e o router; nenhum dos dois importa aqui.
vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/actions', () => ({ sair: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }))

import { RECEBIMENTO } from '../app-shell'

describe('menu do Recebimento', () => {
  it('"Dashboard" fica entre Fluxo e Registros', () => {
    const chaves = RECEBIMENTO.map((i) => i.chave)
    const fluxo = chaves.indexOf('rec-fluxo')
    expect(chaves[fluxo + 1]).toBe('rec-dashboard')
    expect(chaves[fluxo + 2]).toBe('rec-registros')
  })
  it('aponta para /recebimento/dashboard, com ícone de gráfico e a permissão de visualizar', () => {
    const item = RECEBIMENTO.find((i) => i.chave === 'rec-dashboard')!
    expect(item).toMatchObject({
      rotulo: 'Dashboard', href: '/recebimento/dashboard', modulo: 'recebimento', perm: 'visualizar',
    })
    expect(item.icone).toBe(ChartColumn)
  })
})
