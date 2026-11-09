// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { redirect, signInWithPassword } = vi.hoisted(() => ({
  redirect: vi.fn((destino: string) => {
    throw new Error(`REDIRECT ${destino}`)
  }),
  signInWithPassword: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect }))
vi.mock('next/headers', () => ({ headers: vi.fn() }))
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { signInWithPassword } }),
}))

import { entrar } from '../actions'

function form(campos: Record<string, string>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}
const CREDENCIAIS = { email: 'a@enterplak.com.br', senha: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  signInWithPassword.mockResolvedValue({ error: null })
})

describe('entrar: depois do login volta ao destino', () => {
  it('sem destino vai pro /home', async () => {
    await expect(entrar(undefined, form(CREDENCIAIS))).rejects.toThrow('REDIRECT /home')
  })

  it('destino interno (com query) é respeitado', async () => {
    const next = '/shopfloor/analisar/parados?regra=abc'
    await expect(entrar(undefined, form({ ...CREDENCIAIS, next }))).rejects.toThrow(`REDIRECT ${next}`)
    expect(redirect).toHaveBeenCalledWith(next)
  })

  it('destino forjado no formulário vira /home', async () => {
    for (const next of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/login']) {
      redirect.mockClear()
      await expect(entrar(undefined, form({ ...CREDENCIAIS, next }))).rejects.toThrow('REDIRECT /home')
      expect(redirect, next).toHaveBeenCalledWith('/home')
    }
  })

  it('senha errada não redireciona (nem pro destino)', async () => {
    signInWithPassword.mockResolvedValue({ error: { status: 400, code: 'invalid_credentials' } })
    const r = await entrar(undefined, form({ ...CREDENCIAIS, next: '/shopfloor/fluxo' }))
    expect(r.erro).toBeTruthy()
    expect(redirect).not.toHaveBeenCalled()
  })
})
