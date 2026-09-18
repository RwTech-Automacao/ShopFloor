import { after } from 'next/server'
import { tratarInteracaoDiscord } from '@/modules/alertas/application/webhook-discord'
import { criarDependenciasAlertas } from '@/modules/alertas/infra/fabrica'
import { verificarAssinaturaDiscord } from '@/modules/alertas/infra/assinatura'

export const dynamic = 'force-dynamic'

/**
 * Webhook de interações do Discord. A assinatura cobre `timestamp + CORPO CRU`, então o corpo é
 * lido como TEXTO antes de qualquer parse. O Discord espera resposta em 3 s — o que sobra
 * (avisar os outros destinatários, limpar botões) vai para `after`.
 */
export async function POST(request: Request): Promise<Response> {
  const chave = process.env.DISCORD_PUBLIC_KEY ?? ''
  const corpo = await request.text()
  const assinaturaOk = verificarAssinaturaDiscord(
    chave,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
    corpo,
  )
  if (!assinaturaOk) return new Response('Assinatura inválida', { status: 401 })

  let interacao: unknown
  try {
    interacao = JSON.parse(corpo)
  } catch {
    return new Response('JSON inválido', { status: 400 })
  }

  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resposta = await tratarInteracaoDiscord(interacao, { portas, repo })
    if (resposta.depois) {
      const tarefa = resposta.depois
      after(async () => {
        try {
          await tarefa()
        } catch (e) {
          console.error('[alertas] pós-resposta do discord:', e instanceof Error ? e.message : e)
        }
      })
    }
    return Response.json(resposta.corpo)
  } catch (e) {
    console.error('[alertas] webhook discord:', e instanceof Error ? e.message : e)
    return Response.json({
      type: 4,
      data: { content: 'Não foi possível concluir agora. Tente de novo em instantes.', flags: 64 },
    })
  }
}
