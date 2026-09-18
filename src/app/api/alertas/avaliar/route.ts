import { avaliarEEnviar } from '@/modules/alertas/application/enviar-alertas'
import { criarDependenciasAlertas } from '@/modules/alertas/infra/fabrica'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e escreve no banco: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/**
 * Chamada pelo crontab da Lightsail a cada 5 minutos:
 *   curl -fsS -m 60 -X POST -H "Authorization: Bearer $ALERTAS_CRON_SECRET" .../api/alertas/avaliar
 * Com o RDS desligado (plano de economia), responde 503 e registra no log — nada mais.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ALERTAS_CRON_SECRET ?? ''
  if (esperado === '') {
    return Response.json({ erro: 'Alertas não configurados neste ambiente.' }, { status: 503 })
  }

  // Só o formato `Bearer <segredo>`: o segredo cru, sem o prefixo, também é recusado.
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) {
    return Response.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  try {
    const { portas, repo } = criarDependenciasAlertas()
    const resumo = await avaliarEEnviar(portas, repo)
    return Response.json(resumo)
  } catch (e) {
    console.error('[alertas] avaliar falhou:', e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503 })
  }
}
