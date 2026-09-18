import { montarCallbackResolver } from '../domain/codigos'
import type { ResultadoEnvio, ResultadoSimples } from '../domain/tipos'

const TEMPO_LIMITE_MS = 10_000

export interface TelegramClient {
  enviarMensagem(chatId: string, texto: string, ocorrenciaIdBotao: string | null): Promise<ResultadoEnvio>
  editarTexto(mensagemExternaId: string, texto: string): Promise<ResultadoSimples>
  removerBotoes(mensagemExternaId: string): Promise<ResultadoSimples>
  responderCallback(callbackQueryId: string, texto: string): Promise<ResultadoSimples>
}

export function payloadMensagemTelegram(
  chatId: string,
  texto: string,
  ocorrenciaIdBotao: string | null,
): Record<string, unknown> {
  const base: Record<string, unknown> = { chat_id: chatId, text: texto, disable_web_page_preview: true }
  if (!ocorrenciaIdBotao) return base
  return {
    ...base,
    reply_markup: {
      inline_keyboard: [[{ text: '✅ Resolvido', callback_data: montarCallbackResolver(ocorrenciaIdBotao) }]],
    },
  }
}

/** '<chat id>:<message id>' — é o par que o Telegram exige para EDITAR a mensagem depois. */
export function montarIdMensagemTelegram(chatId: string | number, messageId: string | number): string {
  return `${chatId}:${messageId}`
}

function separarId(id: string): { chatId: string; messageId: number } | null {
  const i = id.lastIndexOf(':')
  if (i <= 0) return null
  const messageId = Number(id.slice(i + 1))
  if (!Number.isInteger(messageId)) return null
  return { chatId: id.slice(0, i), messageId }
}

export function criarTelegram(cfg: { token: string; fetch?: typeof fetch }): TelegramClient {
  async function chamar(
    metodo: string,
    corpo: Record<string, unknown>,
  ): Promise<{ ok: true; resultado: Record<string, unknown> } | { ok: false; erro: string }> {
    const f = cfg.fetch ?? fetch
    try {
      const res = await f(`https://api.telegram.org/bot${cfg.token}/${metodo}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      })
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; result?: unknown; description?: string }
        | null
      if (!res.ok || json?.ok !== true) {
        const descricao = json?.description ?? 'sem descrição'
        // Editar uma mensagem que já está sem botão devolve erro, mas o resultado desejado já está lá.
        if (descricao.includes('message is not modified')) return { ok: true, resultado: {} }
        return { ok: false, erro: `Telegram ${res.status}: ${descricao}` }
      }
      const resultado = json.result
      return { ok: true, resultado: typeof resultado === 'object' && resultado !== null ? (resultado as Record<string, unknown>) : {} }
    } catch (e) {
      // NUNCA embutir a URL no erro: ela carrega o token do bot, e o erro vai pro banco/tela.
      return { ok: false, erro: `Telegram: ${e instanceof Error ? e.message : String(e)}` }
    }
  }

  return {
    async enviarMensagem(chatId, texto, ocorrenciaIdBotao) {
      const r = await chamar('sendMessage', payloadMensagemTelegram(chatId, texto, ocorrenciaIdBotao))
      if (!r.ok) return r
      const messageId = r.resultado.message_id
      if (typeof messageId !== 'number') return { ok: false, erro: 'Telegram: resposta sem message_id' }
      return { ok: true, mensagemExternaId: montarIdMensagemTelegram(chatId, messageId) }
    },

    async editarTexto(mensagemExternaId, texto) {
      const p = separarId(mensagemExternaId)
      if (!p) return { ok: false, erro: 'Telegram: id de mensagem inválido' }
      // Sem `reply_markup` na edição, o Telegram remove o teclado — é o que a gente quer.
      const r = await chamar('editMessageText', {
        chat_id: p.chatId,
        message_id: p.messageId,
        text: texto,
        disable_web_page_preview: true,
      })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },

    async removerBotoes(mensagemExternaId) {
      const p = separarId(mensagemExternaId)
      if (!p) return { ok: false, erro: 'Telegram: id de mensagem inválido' }
      const r = await chamar('editMessageReplyMarkup', {
        chat_id: p.chatId,
        message_id: p.messageId,
        reply_markup: { inline_keyboard: [] },
      })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },

    async responderCallback(callbackQueryId, texto) {
      const r = await chamar('answerCallbackQuery', { callback_query_id: callbackQueryId, text: texto })
      return r.ok ? { ok: true } : { ok: false, erro: r.erro }
    },
  }
}
