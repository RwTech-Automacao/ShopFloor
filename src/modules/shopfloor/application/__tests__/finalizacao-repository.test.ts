import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: vi.fn() }))

import { sincronizarFinalizacaoDasOps } from '../../infra/finalizacao-repository'

const clienteCom = (resposta: { data: unknown; error: { message: string } | null }) => {
  const rpc = vi.fn(async () => resposta)
  return { rpc, sb: { rpc } as unknown as SupabaseClient }
}

describe('sincronizarFinalizacaoDasOps', () => {
  it('chama a função certa do banco e devolve o resumo lido', async () => {
    const { rpc, sb } = clienteCom({ data: { finalizadas: 3, reabertas: 1 }, error: null })
    const r = await sincronizarFinalizacaoDasOps(sb)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('sf_sincronizar_finalizacao')
    expect(r).toEqual({ finalizadas: 3, reabertas: 1 })
  })

  it('lança, com o nome da função, quando o banco devolve erro', async () => {
    const { sb } = clienteCom({ data: null, error: { message: 'permission denied' } })
    await expect(sincronizarFinalizacaoDasOps(sb)).rejects.toThrow(/sf_sincronizar_finalizacao.*permission denied/)
  })
})
