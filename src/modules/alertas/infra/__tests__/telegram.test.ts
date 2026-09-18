// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { criarTelegram, payloadMensagemTelegram, montarIdMensagemTelegram } from '../telegram'

/** fetch de mentira: guarda as chamadas e devolve as respostas na ordem. */
function fetchFalso(respostas: { corpo: unknown; status?: number }[]) {
  const chamadas: { url: string; corpo: unknown }[] = []
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), corpo: JSON.parse(String(init?.body ?? '{}')) })
    const r = respostas[chamadas.length - 1] ?? { corpo: { ok: true, result: {} } }
    return new Response(JSON.stringify(r.corpo), {
      status: r.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { fn, chamadas }
}

describe('payloadMensagemTelegram', () => {
  it('sem ocorrência não manda teclado', () => {
    expect(payloadMensagemTelegram('123', 'oi', null)).toEqual({
      chat_id: '123',
      text: 'oi',
      disable_web_page_preview: true,
    })
  })
  it('com ocorrência manda o botão Resolvido com o callback curto', () => {
    const p = payloadMensagemTelegram('123', 'oi', '11111111-2222-3333-4444-555555555555')
    expect(p.reply_markup).toEqual({
      inline_keyboard: [[{ text: '✅ Resolvido', callback_data: 'r:11111111-2222-3333-4444-555555555555' }]],
    })
  })
})

describe('montarIdMensagemTelegram', () => {
  it('junta chat e mensagem', () => {
    expect(montarIdMensagemTelegram(123, 456)).toBe('123:456')
  })
})

describe('criarTelegram', () => {
  it('envia a mensagem e devolve chat:message', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: { message_id: 456 } } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r).toEqual({ ok: true, mensagemExternaId: '123:456' })
    expect(chamadas[0]!.url).toBe('https://api.telegram.org/botTOKEN/sendMessage')
  })

  it('erro da API vira { ok: false } sem vazar o token', async () => {
    const { fn } = fetchFalso([{ corpo: { ok: false, description: 'chat not found' }, status: 400 }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erro).toBe('Telegram 400: chat not found')
      expect(r.erro).not.toContain('TOKEN')
    }
  })

  it('resposta sem message_id é falha', async () => {
    const { fn } = fetchFalso([{ corpo: { ok: true, result: {} } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r.ok).toBe(false)
  })

  it('editarTexto usa editMessageText e não reenvia teclado', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: {} } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.editarTexto('123:456', 'novo texto')
    expect(r).toEqual({ ok: true })
    expect(chamadas[0]!.url).toContain('/editMessageText')
    expect(chamadas[0]!.corpo).toMatchObject({ chat_id: '123', message_id: 456, text: 'novo texto' })
    expect(chamadas[0]!.corpo).not.toHaveProperty('reply_markup')
  })

  it('removerBotoes manda teclado vazio', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: {} } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    await tg.removerBotoes('123:456')
    expect(chamadas[0]!.url).toContain('/editMessageReplyMarkup')
    expect(chamadas[0]!.corpo).toMatchObject({ reply_markup: { inline_keyboard: [] } })
  })

  it('"message is not modified" conta como sucesso (o botão já estava fora)', async () => {
    const { fn } = fetchFalso([
      { corpo: { ok: false, description: 'Bad Request: message is not modified' }, status: 400 },
    ])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    expect(await tg.removerBotoes('123:456')).toEqual({ ok: true })
  })

  it('id de mensagem inválido não chega a chamar a API', async () => {
    const { fn, chamadas } = fetchFalso([])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.removerBotoes('sem-message-id')
    expect(r.ok).toBe(false)
    expect(chamadas).toHaveLength(0)
  })

  it('responderCallback usa answerCallbackQuery', async () => {
    const { fn, chamadas } = fetchFalso([{ corpo: { ok: true, result: true } }])
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    await tg.responderCallback('cb1', 'Marcado como resolvido.')
    expect(chamadas[0]!.url).toContain('/answerCallbackQuery')
    expect(chamadas[0]!.corpo).toEqual({ callback_query_id: 'cb1', text: 'Marcado como resolvido.' })
  })

  it('falha de rede vira { ok: false } com a mensagem do erro', async () => {
    const fn = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch
    const tg = criarTelegram({ token: 'TOKEN', fetch: fn })
    const r = await tg.enviarMensagem('123', 'oi', null)
    expect(r).toEqual({ ok: false, erro: 'Telegram: fetch failed' })
  })
})
