// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { criarDiscord, payloadMensagemDiscord } from '../discord'

function fetchFalso(respostas: { corpo: unknown; status?: number }[]) {
  const chamadas: { url: string; metodo: string; corpo: unknown; autorizacao: string }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const cabecalhos = (init?.headers ?? {}) as Record<string, string>
    chamadas.push({
      url: String(url),
      metodo: String(init?.method ?? 'GET'),
      corpo: JSON.parse(String(init?.body ?? '{}')),
      autorizacao: cabecalhos.Authorization ?? '',
    })
    const r = respostas[chamadas.length - 1] ?? { corpo: {} }
    return new Response(JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

describe('payloadMensagemDiscord', () => {
  it('sem ocorrência vai só o conteúdo (sem menções)', () => {
    expect(payloadMensagemDiscord('oi', null)).toEqual({ content: 'oi', allowed_mentions: { parse: [] } })
  })
  it('com ocorrência inclui o botão com custom_id', () => {
    const p = payloadMensagemDiscord('oi', '11111111-2222-3333-4444-555555555555')
    expect(p.components).toEqual([
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: 'Resolvido',
            emoji: { name: '✅' },
            custom_id: 'r:11111111-2222-3333-4444-555555555555',
          },
        ],
      },
    ])
  })
})

describe('criarDiscord', () => {
  it('abre a DM e envia, devolvendo canal:mensagem', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { id: 'C9' } }, { corpo: { id: 'M7' } }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    const r = await dc.enviarDm('U1', 'oi', null)
    expect(r).toEqual({ ok: true, mensagemExternaId: 'C9:M7' })
    expect(chamadas[0]).toMatchObject({
      url: 'https://discord.com/api/v10/users/@me/channels',
      metodo: 'POST',
      corpo: { recipient_id: 'U1' },
      autorizacao: 'Bot BOTTOKEN',
    })
    expect(chamadas[1]!.url).toBe('https://discord.com/api/v10/channels/C9/messages')
  })

  it('DM bloqueada (403) vira falha com a mensagem do Discord', async () => {
    const { fn } = fetchFalso([{ corpo: { message: 'Cannot send messages to this user' }, status: 403 }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    const r = await dc.enviarDm('U1', 'oi', null)
    expect(r).toEqual({ ok: false, erro: 'Discord 403: Cannot send messages to this user' })
  })

  it('removerBotoes faz PATCH na mensagem com components vazio', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: {} }])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    expect(await dc.removerBotoes('C9:M7')).toEqual({ ok: true })
    expect(chamadas[0]).toMatchObject({
      url: 'https://discord.com/api/v10/channels/C9/messages/M7',
      metodo: 'PATCH',
      corpo: { components: [] },
    })
  })

  it('id de mensagem inválido não chama a API', async () => {
    const { fn, chamadas } = fetchFalso([])
    const dc = criarDiscord({ token: 'BOTTOKEN', fetch: fn })
    expect((await dc.removerBotoes('semcanal')).ok).toBe(false)
    expect(chamadas).toHaveLength(0)
  })
})
