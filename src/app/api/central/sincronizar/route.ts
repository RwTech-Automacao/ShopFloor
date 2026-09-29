import { sincronizar } from '@/modules/central/application/sincronizar'
import { criarDependenciasCentral } from '@/modules/central/infra/fabrica'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e lê o banco na hora: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/**
 * Chamada pelo crontab da Lightsail de hora em hora (segredo num arquivo de cabeçalho 600, nunca
 * no argv — ver tools/central-sync/README.md):
 *   curl -fsS -m 120 -X POST -H @$HOME/.central-sync-cron-header http://127.0.0.1:3000/api/central/sincronizar
 * Sem CENTRAL_SYNC_CRON_SECRET, CENTRAL_SYNC_SECRET ou CENTRAL_SYNC_URL configurados neste
 * ambiente, responde 503 e o resto do app segue normal (mesma regra dos Alertas).
 */
export async function POST(request: Request): Promise<Response> {
  const cronSecret = process.env.CENTRAL_SYNC_CRON_SECRET ?? ''
  const centralSecret = process.env.CENTRAL_SYNC_SECRET ?? ''
  const centralUrl = process.env.CENTRAL_SYNC_URL ?? ''
  if (cronSecret === '' || centralSecret === '' || centralUrl === '') {
    return Response.json(
      { erro: 'Sincronização com a Central do Cliente não está configurada neste ambiente.' },
      { status: 503 },
    )
  }

  // Só o formato `Bearer <segredo>`: o segredo cru, sem o prefixo, também é recusado.
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, cronSecret)) {
    return Response.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  let dependencias: ReturnType<typeof criarDependenciasCentral>
  try {
    dependencias = criarDependenciasCentral()
  } catch (e) {
    console.error('[central] falha ao montar as dependências:', e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503 })
  }

  const resultado = await sincronizar(dependencias.leitor, dependencias.enviador)

  if (resultado.etapa === 'leitura') {
    console.error('[central] leitura do banco falhou:', resultado.erro)
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503 })
  }

  if (resultado.etapa === 'envio') {
    console.error('[central] envio pra Central falhou:', resultado.erro)
    return Response.json({ erro: 'Central do Cliente indisponível.' }, { status: 502 })
  }

  if (resultado.status !== 200) {
    console.error('[central] Central respondeu status', resultado.status)
    return Response.json({ erro: 'Central do Cliente recusou a sincronização.' }, { status: 502 })
  }

  return Response.json(resultado.corpo, { status: 200 })
}
