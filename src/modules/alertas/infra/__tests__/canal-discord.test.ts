// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { canalDiscordDoSistema, criarPortasCanais } from '../canais'
import { criarDiscord } from '../discord'

function fetchFalso(respostas: { corpo: unknown; status?: number }[]) {
  const chamadas: { url: string; metodo: string; corpo: unknown }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: String(init?.method ?? 'GET'),
      corpo: JSON.parse(String(init?.body ?? '{}')),
    })
    const r = respostas[chamadas.length - 1] ?? { corpo: {} }
    return new Response(JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

describe('canalDiscordDoSistema', () => {
  it('lê o DISCORD_CANAL_ID, aparado', () => {
    expect(canalDiscordDoSistema({ DISCORD_CANAL_ID: ' C9 ' } as unknown as NodeJS.ProcessEnv)).toBe('C9')
  })
  it('ausente ou vazio = ambiente sem canal', () => {
    expect(canalDiscordDoSistema({} as NodeJS.ProcessEnv)).toBeNull()
    expect(canalDiscordDoSistema({ DISCORD_CANAL_ID: '   ' } as unknown as NodeJS.ProcessEnv)).toBeNull()
  })
})

describe('criarDiscord — enviarCanal', () => {
  it('posta direto no canal, SEM criar DM antes', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { id: 'M7' } }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    const r = await dc.enviarCanal('C9', 'oi', null)
    expect(r).toEqual({ ok: true, mensagemExternaId: 'C9:M7' })
    // Uma chamada só: a criação de DM (/users/@me/channels) não acontece.
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]).toMatchObject({
      url: 'https://discord.com/api/v10/channels/C9/messages',
      metodo: 'POST',
      corpo: { content: 'oi', allowed_mentions: { parse: [] } },
    })
  })

  it('leva o botão "Resolvido" como na conversa privada', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { id: 'M7' } }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    await dc.enviarCanal('C9', 'oi', '11111111-2222-3333-4444-555555555555')
    expect((chamadas[0]!.corpo as { components?: unknown[] }).components).toBeDefined()
  })

  it('sem permissão no canal (403) vira falha com a mensagem do Discord', async () => {
    const { fn } = fetchFalso([{ corpo: { message: 'Missing Access' }, status: 403 }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    expect(await dc.enviarCanal('C9', 'oi', null)).toEqual({ ok: false, erro: 'Discord 403: Missing Access' })
  })
})

describe('criarPortasCanais — destino da linha da fila', () => {
  it('Discord: destino de canal posta no canal; destino de pessoa abre a DM', async () => {
    // A porta real usa o fetch global (o client é montado dentro de criarPortasCanais).
    const { fn, chamadas } = fetchFalso([{ corpo: { id: 'M1' } }, { corpo: { id: 'C9' } }, { corpo: { id: 'M2' } }])
    const original = globalThis.fetch
    globalThis.fetch = fn
    try {
      const portas = criarPortasCanais({ DISCORD_BOT_TOKEN: 'D' } as unknown as NodeJS.ProcessEnv)
      expect(await portas.discord!.enviar({ tipo: 'canal', externoId: 'C9' }, 'no canal', null)).toEqual({
        ok: true,
        mensagemExternaId: 'C9:M1',
      })
      expect(await portas.discord!.enviar({ tipo: 'usuario', externoId: 'U1' }, 'no privado', null)).toEqual({
        ok: true,
        mensagemExternaId: 'C9:M2',
      })
    } finally {
      globalThis.fetch = original
    }
    expect(chamadas.map((c) => c.url)).toEqual([
      // canal: posta direto
      'https://discord.com/api/v10/channels/C9/messages',
      // pessoa: cria a DM e só então posta
      'https://discord.com/api/v10/users/@me/channels',
      'https://discord.com/api/v10/channels/C9/messages',
    ])
  })

  it('Telegram recusa destino de canal (só conversa privada)', async () => {
    const portas = criarPortasCanais({ TELEGRAM_BOT_TOKEN: 'T' } as unknown as NodeJS.ProcessEnv)
    const r = await portas.telegram!.enviar({ tipo: 'canal', externoId: 'C9' }, 'oi', null)
    expect(r).toEqual({ ok: false, erro: 'Telegram não avisa em canal, só na conversa privada.' })
  })

  it('só monta as portas dos canais com token', () => {
    const portas = criarPortasCanais({ DISCORD_BOT_TOKEN: 'D' } as unknown as NodeJS.ProcessEnv)
    expect(portas.discord).toBeDefined()
    expect(portas.telegram).toBeUndefined()
  })
})
