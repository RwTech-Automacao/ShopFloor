// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import type { RespostaDiscord } from '@/modules/alertas/application/webhook-discord'

vi.mock('server-only', () => ({}))

// vi.mock é içado para o topo do arquivo: os mocks precisam nascer num vi.hoisted.
const { criarDependenciasAlertas, tratarUpdateTelegram, tratarInteracaoDiscord } = vi.hoisted(() => ({
  criarDependenciasAlertas: vi.fn(() => ({ portas: {}, repo: {} })),
  tratarUpdateTelegram: vi.fn(async (): Promise<void> => {}),
  tratarInteracaoDiscord: vi.fn(
    async (): Promise<RespostaDiscord> => ({ corpo: { type: 1 }, depois: null }),
  ),
}))
vi.mock('@/modules/alertas/infra/fabrica', () => ({ criarDependenciasAlertas }))
vi.mock('@/modules/alertas/application/webhook-telegram', () => ({ tratarUpdateTelegram }))
vi.mock('@/modules/alertas/application/webhook-discord', () => ({ tratarInteracaoDiscord }))

// `after` fora do ciclo de requisição do Next não roda; aqui executa na hora.
vi.mock('next/server', () => ({ after: (fn: () => Promise<void>) => void fn() }))

import { POST as POST_TELEGRAM } from '@/app/api/alertas/telegram/route'
import { POST as POST_DISCORD } from '@/app/api/alertas/discord/route'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const CHAVE_HEX = (publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(12).toString('hex')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'TOKEN')
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'segredo-webhook')
  vi.stubEnv('DISCORD_PUBLIC_KEY', CHAVE_HEX)
})

describe('POST /api/alertas/telegram', () => {
  function pedido(cabecalhos: Record<string, string>, corpo: unknown = { message: {} }) {
    return new Request('https://shopfloor.enterplak.com.br/api/alertas/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cabecalhos },
      body: JSON.stringify(corpo),
    })
  }

  it('sem o secret token devolve 401 e não trata nada', async () => {
    const res = await POST_TELEGRAM(pedido({}))
    expect(res.status).toBe(401)
    expect(tratarUpdateTelegram).not.toHaveBeenCalled()
  })

  it('secret token errado devolve 401', async () => {
    const res = await POST_TELEGRAM(pedido({ 'x-telegram-bot-api-secret-token': 'outro' }))
    expect(res.status).toBe(401)
  })

  it('secret token certo trata o update e responde 200', async () => {
    const res = await POST_TELEGRAM(pedido({ 'x-telegram-bot-api-secret-token': 'segredo-webhook' }))
    expect(res.status).toBe(200)
    expect(tratarUpdateTelegram).toHaveBeenCalledTimes(1)
  })

  it('erro no tratamento continua respondendo 200 (o Telegram não deve reenviar)', async () => {
    tratarUpdateTelegram.mockRejectedValueOnce(new Error('banco fora'))
    const res = await POST_TELEGRAM(pedido({ 'x-telegram-bot-api-secret-token': 'segredo-webhook' }))
    expect(res.status).toBe(200)
  })
})

describe('POST /api/alertas/discord', () => {
  function pedido(corpo: unknown, opcoes: { assinar?: boolean } = { assinar: true }) {
    const texto = JSON.stringify(corpo)
    const ts = '1789000000'
    const assinatura = opcoes.assinar
      ? sign(null, Buffer.from(ts + texto), privateKey).toString('hex')
      : 'aa'.repeat(64)
    return new Request('https://shopfloor.enterplak.com.br/api/alertas/discord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature-ed25519': assinatura,
        'x-signature-timestamp': ts,
      },
      body: texto,
    })
  }

  it('assinatura inválida devolve 401', async () => {
    const res = await POST_DISCORD(pedido({ type: 1 }, { assinar: false }))
    expect(res.status).toBe(401)
    expect(tratarInteracaoDiscord).not.toHaveBeenCalled()
  })

  it('assinatura válida responde o corpo devolvido pelo handler', async () => {
    const res = await POST_DISCORD(pedido({ type: 1 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: 1 })
    expect(tratarInteracaoDiscord).toHaveBeenCalledTimes(1)
  })

  it('agenda o trabalho de depois', async () => {
    const depois = vi.fn(async () => {})
    tratarInteracaoDiscord.mockResolvedValueOnce({ corpo: { type: 7 }, depois })
    await POST_DISCORD(pedido({ type: 3 }))
    expect(depois).toHaveBeenCalledTimes(1)
  })

  it('erro no handler responde mensagem efêmera em vez de estourar', async () => {
    tratarInteracaoDiscord.mockRejectedValueOnce(new Error('banco fora'))
    const res = await POST_DISCORD(pedido({ type: 3 }))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { data: { content: string; flags: number } }
    expect(json.data.flags).toBe(64)
  })
})
