import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { sincronizarEspelhoOps } from '@/modules/compels/application/sincronizar-espelho-ops'
import { gravarEspelhoDoServico } from '@/modules/shopfloor/infra/espelho-ops-repository'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e lê o Compels: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/** Prefixo de toda linha de log desta rodada — é por ele que se filtra o log do pm2. */
const TAG = '[espelho-ops]'

/** Uma rodada por vez neste processo. */
let rodando = false

/**
 * ESPELHO DAS OPs ATIVAS DO COMPELS (spec 2026-11-18-cadastro-op-compels-design.md): de 10 em 10 minutos o crontab
 * da instância chama esta rota com o MESMO segredo e o mesmo arquivo de cabeçalho do cron de estoque:
 *   curl -fsS -m 120 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/compels/espelho-ops
 * Só lê o Compels; grava em sf_compels_ops com a service role. Compels fora = 503 e o espelho fica como estava.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ESTOQUE_CRON_SECRET ?? ''
  if (esperado === '') return Response.json({ erro: 'Cron não configurado neste ambiente.' }, { status: 503 })
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) return Response.json({ erro: 'Não autorizado.' }, { status: 401 })

  if (rodando) return Response.json({ ocupado: true })
  rodando = true
  try {
    const cliente = new ClienteCompels(configDoAmbiente())
    const r = await sincronizarEspelhoOps({ listar: () => cliente.listarOpsAtivas(), gravar: gravarEspelhoDoServico() })
    console.log(`${TAG} ${new Date().toISOString()} ${r.lidas} OPs ativas lidas; novas ${r.novas}, atualizadas ${r.atualizadas}, saíram ${r.inativadas}`)
    return Response.json(r)
  } catch (e) {
    console.error(`${TAG} ${new Date().toISOString()} rodada não aconteceu:`, e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Compels ou banco indisponível.' }, { status: 503 })
  } finally {
    rodando = false
  }
}
