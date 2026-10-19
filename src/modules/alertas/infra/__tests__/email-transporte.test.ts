import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createTransport, sendMail } = vi.hoisted(() => {
  const sendMail = vi.fn()
  return { sendMail, createTransport: vi.fn(() => ({ sendMail })) }
})
vi.mock('nodemailer', () => ({ createTransport }))

import { criarEmail } from '../email'

const CFG = {
  host: 'smtp.exemplo.com',
  porta: 587,
  usuario: 'alertas@enterplak.com.br',
  senha: 'x',
  remetente: 'ShopFloor <alertas@enterplak.com.br>',
  seguro: false,
}

describe('criarEmail — transporte do nodemailer', () => {
  beforeEach(() => {
    createTransport.mockClear()
    sendMail.mockReset().mockResolvedValue({ messageId: '<m@x>' })
  })

  it('dois envios simultâneos criam o transporte UMA vez', async () => {
    const cli = criarEmail(CFG)
    const [a, b] = await Promise.all([
      cli.enviarMensagem('a@x', 'A\nB'),
      cli.enviarMensagem('b@x', 'C\nD'),
    ])
    expect(a.ok && b.ok).toBe(true)
    expect(createTransport).toHaveBeenCalledTimes(1)
    expect(sendMail).toHaveBeenCalledTimes(2)
  })

  it('não usa pool: o cliente vive uma rodada e ninguém fecha o pool depois', async () => {
    await criarEmail(CFG).enviarMensagem('a@x', 'A\nB')
    const opcoes = (createTransport.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(opcoes.pool).toBe(false)
    expect(opcoes).not.toHaveProperty('maxConnections')
  })
})
