import type { TelegramClient } from '../infra/telegram'
import { extrairCodigoVinculo, lerCallbackResolver } from '../domain/codigos'
import { TEXTO_INSTRUCOES_TELEGRAM, textoResolvido, textoVinculado } from '../domain/mensagens'
import { montarIdMensagemTelegram } from '../infra/telegram'
import { entregarPendentes, removerBotoesDaOcorrencia } from './enviar-alertas'
import type { DependenciasWebhook } from './portas'

interface MensagemTelegram {
  chat?: { id?: number | string; type?: string }
  text?: string
}

interface CallbackTelegram {
  id?: string
  from?: { id?: number | string }
  data?: string
  message?: { chat?: { id?: number | string }; message_id?: number; text?: string }
}

interface UpdateTelegram {
  message?: MensagemTelegram
  callback_query?: CallbackTelegram
}

type Deps = DependenciasWebhook & { telegram: TelegramClient }

/**
 * Trata um update do Telegram. Nunca lança: a rota responde 200 de qualquer jeito (o Telegram
 * reenvia o update em erro, e um update repetido geraria mensagem repetida).
 */
export async function tratarUpdateTelegram(update: unknown, deps: Deps): Promise<void> {
  const u = (update ?? {}) as UpdateTelegram
  if (u.message) return tratarMensagem(u.message, deps)
  if (u.callback_query) return tratarCallback(u.callback_query, deps)
}

async function tratarMensagem(m: MensagemTelegram, deps: Deps): Promise<void> {
  // Só conversa privada: o vínculo é pessoal, e em grupo o chat id não é de ninguém.
  if (m.chat?.type !== 'private' || m.chat.id === undefined) return
  const chatId = String(m.chat.id)

  const codigo = extrairCodigoVinculo(m.text)
  if (!codigo) {
    await deps.telegram.enviarMensagem(chatId, TEXTO_INSTRUCOES_TELEGRAM, null)
    return
  }

  const r = await deps.repo.vincular(codigo, 'telegram', chatId)
  await deps.telegram.enviarMensagem(chatId, r.ok ? textoVinculado(r.nome) : r.erro, null)
}

async function tratarCallback(q: CallbackTelegram, deps: Deps): Promise<void> {
  const id = q.id
  if (!id) return
  // O Telegram deixa o botão "girando" até o callback ser respondido. Qualquer erro no meio do
  // caminho (banco fora, etc.) ainda precisa de UMA resposta — por isso a flag + finally.
  let respondido = false
  const responder = async (texto: string) => {
    respondido = true
    await deps.telegram.responderCallback(id, texto)
  }
  try {
    await resolverPeloBotao(q, responder, deps)
  } finally {
    if (!respondido) {
      try {
        await deps.telegram.responderCallback(id, 'Não foi possível concluir agora.')
      } catch {
        // o erro original é o que importa; a rota registra
      }
    }
  }
}

async function resolverPeloBotao(
  q: CallbackTelegram,
  responder: (texto: string) => Promise<void>,
  deps: Deps,
): Promise<void> {
  const ocorrenciaId = lerCallbackResolver(q.data)
  if (!ocorrenciaId || q.from?.id === undefined) {
    await responder('Ação desconhecida.')
    return
  }

  const usuarioId = await deps.repo.usuarioPorConta('telegram', String(q.from.id))
  if (!usuarioId) {
    await responder('Sua conta do Telegram não está vinculada ao ShopFloor.')
    return
  }

  const r = await deps.repo.resolver(ocorrenciaId, usuarioId)
  if (!r.ok) {
    await responder(r.erro)
    // Já normalizou: o botão não serve mais pra nada, então sai de todas as mensagens.
    if (r.codigo === 'OCORRENCIA_ENCERRADA') {
      await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)
    }
    return
  }

  const res = r.resolucao
  const linha = textoResolvido({ posto: res.posto, nome: res.resolvidaPorNome, em: res.resolvidaEm })
  await responder(res.jaResolvida ? `Já resolvido por ${res.resolvidaPorNome}.` : 'Marcado como resolvido.')

  if (q.message?.chat?.id !== undefined && q.message.message_id !== undefined) {
    const id = montarIdMensagemTelegram(q.message.chat.id, q.message.message_id)
    await deps.telegram.editarTexto(id, `${q.message.text ?? ''}\n\n${linha}`.trim())
  }

  await removerBotoesDaOcorrencia(deps.portas, deps.repo, ocorrenciaId)

  // O "resolvido por" dos outros destinatários JÁ ESTÁ NA FILA: o alerta_resolver enfileirou na
  // mesma transação da resolução. Aqui só se adianta a entrega (só desta ocorrência — a reserva é
  // atômica, então o cron nunca manda de novo). Se o processo cair antes, o cron entrega depois.
  if (!res.jaResolvida) {
    await entregarPendentes(deps.portas, deps.repo, { ocorrenciaId })
  }
}
