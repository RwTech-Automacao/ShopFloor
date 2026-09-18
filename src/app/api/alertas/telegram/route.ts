import { tratarUpdateTelegram } from '@/modules/alertas/application/webhook-telegram'
import { criarDependenciasAlertas } from '@/modules/alertas/infra/fabrica'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'
import { criarTelegram } from '@/modules/alertas/infra/telegram'

export const dynamic = 'force-dynamic'

/**
 * Webhook do Telegram. O `secret_token` foi registrado no setWebhook (tools/alertas), e o Telegram
 * o devolve neste cabeçalho — é o que separa um update de verdade de qualquer POST da internet.
 *
 * Depois de autorizado, responde SEMPRE 200: em erro o Telegram reenvia o mesmo update, e o efeito
 * seria mensagem repetida na conversa da pessoa.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.TELEGRAM_WEBHOOK_SECRET ?? ''
  const token = process.env.TELEGRAM_BOT_TOKEN ?? ''
  if (
    esperado === '' ||
    token === '' ||
    !segredoConfere(request.headers.get('x-telegram-bot-api-secret-token'), esperado)
  ) {
    return new Response('Não autorizado', { status: 401 })
  }

  let update: unknown = null
  try {
    update = await request.json()
  } catch {
    return new Response('ok')
  }

  try {
    const { portas, repo } = criarDependenciasAlertas()
    await tratarUpdateTelegram(update, { telegram: criarTelegram({ token }), portas, repo })
  } catch (e) {
    console.error('[alertas] webhook telegram:', e instanceof Error ? e.message : e)
  }
  return new Response('ok')
}
