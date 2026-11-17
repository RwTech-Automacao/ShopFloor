import { sincronizarPlanilha } from '@/modules/sat/application/sincronizar-planilha'
import { baixarAba, configPlanilha } from '@/modules/sat/infra/planilha-google'
import { gravarOsDoServico } from '@/modules/sat/infra/os-repository'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e lê a planilha: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/** Prefixo de toda linha de log desta rodada — é por ele que se filtra o log do pm2. */
const TAG = '[sat-planilha]'

/** Uma rodada por vez neste processo. */
let rodando = false

/**
 * CÓPIA DA PLANILHA "PEÇAS EM GARANTIA" (spec 2026-11-17-sat-entrada-design.md, decisão 3): de 10 em 10 minutos
 * o crontab da instância chama esta rota com o MESMO segredo e o mesmo arquivo de cabeçalho do cron de estoque:
 *   curl -fsS -m 300 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/sat/sincronizar-planilha
 *
 * Lê as abas pelo export CSV (sem credencial) e grava com a service role. Acrescenta e atualiza; nunca escreve
 * na planilha e nunca apaga do banco. Aba que falha vai pro log e a rodada segue; todas falhando = 503.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ESTOQUE_CRON_SECRET ?? ''
  if (esperado === '') return Response.json({ erro: 'Cron não configurado neste ambiente.' }, { status: 503 })
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) return Response.json({ erro: 'Não autorizado.' }, { status: 401 })

  if (rodando) return Response.json({ ocupado: true })
  rodando = true
  try {
    const { planilhaId, abas } = configPlanilha()
    const resumo = await sincronizarPlanilha(abas, {
      baixarAba: (aba) => baixarAba(planilhaId, aba.gid),
      gravar: gravarOsDoServico(),
    })
    const agora = new Date().toISOString()
    for (const a of resumo.abas) {
      if (a.erro) console.error(`${TAG} ${agora} aba "${a.nome}" não lida: ${a.erro}`)
    }
    const g = resumo.gravado
    console.log(`${TAG} ${agora} ${resumo.os} OS / ${resumo.itens} itens lidos; novas ${g.os_novas} OS e ` +
      `${g.itens_novos} itens, atualizadas ${g.os_atualizadas} OS e ${g.itens_atualizados} itens`)
    return Response.json(resumo)
  } catch (e) {
    console.error(`${TAG} ${new Date().toISOString()} rodada não aconteceu:`, e instanceof Error ? e.message : e)
    return Response.json({ erro: 'Planilha ou banco indisponível.' }, { status: 503 })
  } finally {
    rodando = false
  }
}
