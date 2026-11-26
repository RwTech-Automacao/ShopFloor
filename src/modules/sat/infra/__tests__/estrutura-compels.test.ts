import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))
vi.mock('@/modules/faturamento/infra/compels', () => ({ clienteCompelsDoFaturamento: vi.fn() }))

import { leiturasDoCompels } from '../estrutura-compels'
import type { ArmazemCache } from '../cache-compels'

describe('leiturasDoCompels.estrutura', () => {
  it('normaliza o código (trim + maiúsculas) antes de montar a chave do cache e consultar', async () => {
    const chaves: string[] = []
    const armazem = {
      ler: vi.fn(async (chave: string) => { chaves.push(chave); return null }),
      gravar: vi.fn(async () => {}),
    } as unknown as ArmazemCache
    const cliente = {
      composicaoDoItem: vi.fn(async () => null),
      arvoreDaComposicao: vi.fn(),
      paisDoItem: vi.fn(),
      buscarItens: vi.fn(),
    }
    await leiturasDoCompels(cliente as never, armazem).estrutura(' pmoc31 ')
    expect(chaves[0]).toBe('estrutura:PMOC31')
    expect(cliente.composicaoDoItem).toHaveBeenCalledWith('PMOC31')
  })
})
