import { describe, it, expect, vi, beforeEach } from 'vitest'

const verifyOtp = vi.fn()
vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ auth: { verifyOtp } }),
}))

import { GET } from '../redefinir/route'

// URL com origin "interno" (como fica atrás do nginx) — o redirect não pode depender dele.
const chamar = (qs: string) => GET(new Request(`http://localhost:3000/auth/redefinir${qs}`))

describe('GET /auth/redefinir', () => {
  beforeEach(() => verifyOtp.mockReset())

  it('token válido -> 307 relativo para /redefinir-senha', async () => {
    verifyOtp.mockResolvedValue({ error: null })
    const res = await chamar('?token_hash=abc&type=recovery')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('/redefinir-senha')
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'recovery', token_hash: 'abc' })
  })

  it('verifyOtp com erro -> /esqueci-senha?erro=expirado', async () => {
    verifyOtp.mockResolvedValue({ error: { message: 'expired' } })
    const res = await chamar('?token_hash=abc&type=recovery')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('/esqueci-senha?erro=expirado')
  })

  it('sem token_hash/type -> expirado, sem chamar verifyOtp', async () => {
    const res = await chamar('')
    expect(res.headers.get('location')).toBe('/esqueci-senha?erro=expirado')
    expect(verifyOtp).not.toHaveBeenCalled()
  })
})
