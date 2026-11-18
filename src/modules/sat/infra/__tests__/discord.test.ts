import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const enviarCanal = vi.fn()
vi.mock('@/modules/alertas/infra/discord', () => ({ criarDiscord: () => ({ enviarCanal }) }))
import { avisarSat } from '../discord'

afterEach(() => vi.clearAllMocks())

describe('avisarSat', () => {
  it('canal próprio do SAT; sem ele, o do sistema; sem bot ou sem canal, nada', async () => {
    enviarCanal.mockResolvedValue({ ok: true })
    await avisarSat('oi', { DISCORD_BOT_TOKEN: 't', SAT_DISCORD_CANAL_ID: ' 111 ', DISCORD_CANAL_ID: '222' } as never)
    expect(enviarCanal).toHaveBeenLastCalledWith('111', 'oi', null)
    await avisarSat('oi', { DISCORD_BOT_TOKEN: 't', DISCORD_CANAL_ID: '222' } as never)
    expect(enviarCanal).toHaveBeenLastCalledWith('222', 'oi', null)
    enviarCanal.mockClear()
    await avisarSat('oi', { DISCORD_CANAL_ID: '222' } as never)
    await avisarSat('oi', { DISCORD_BOT_TOKEN: 't' } as never)
    expect(enviarCanal).not.toHaveBeenCalled()
  })

  it('falha (recusa ou exceção) nunca lança', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    enviarCanal.mockResolvedValueOnce({ ok: false, erro: '403' })
    await expect(avisarSat('oi', { DISCORD_BOT_TOKEN: 't', DISCORD_CANAL_ID: '1' } as never)).resolves.toBeUndefined()
    enviarCanal.mockRejectedValueOnce(new Error('rede'))
    await expect(avisarSat('oi', { DISCORD_BOT_TOKEN: 't', DISCORD_CANAL_ID: '1' } as never)).resolves.toBeUndefined()
    expect(erro).toHaveBeenCalledTimes(2)
  })
})
