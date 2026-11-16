import { baixarNfsPendentes, configBaixaNf } from '@/modules/compels/application/baixar-nfs'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e fala com o ERP: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/** Prefixo de toda linha de log desta rodada — é por ele que se filtra o log do pm2. */
const TAG = '[baixa-nf]'

/**
 * BAIXA AUTOMÁTICA DAS NFs DE SAÍDA emitidas sem saldo (spec 2026-11-16-baixa-nf-compels-design.md). Chamada
 * pelo crontab da instância com o MESMO segredo e o mesmo arquivo de cabeçalho do cron de estoque:
 *   curl -fsS -m 300 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/compels/baixa-nf
 *
 * Desligada até `COMPELS_BAIXA_NF_DESDE` (aaaa-mm-dd) e `COMPELS_BAIXA_NF` (`simular` ou `1`) estarem no ambiente.
 * Não usa o banco: só o Compels.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ESTOQUE_CRON_SECRET ?? ''
  if (esperado === '') return Response.json({ erro: 'Cron não configurado neste ambiente.' }, { status: 503 })
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) return Response.json({ erro: 'Não autorizado.' }, { status: 401 })

  const config = configBaixaNf()
  if (!config) return Response.json({ desligada: true })

  try {
    const resumo = await baixarNfsPendentes(new ClienteCompels(configDoAmbiente()), config)
    const agora = new Date().toISOString()
    for (const n of resumo.notas) {
      const linha = `${TAG} ${agora} ${resumo.modo} NF ${n.numero} (${n.emissao}): ${n.resultado} — ${n.detalhe}`
      if (n.resultado === 'falhou' || n.resultado === 'manual') console.error(linha)
      else console.log(linha)
    }
    console.log(`${TAG} ${agora} rodada (${resumo.modo}): ${resumo.notas.length} nota(s) pendente(s) na janela desde ${config.desde}`)
    return Response.json(resumo)
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ${new Date().toISOString()} rodada não aconteceu:`, motivo)
    return Response.json({ erro: 'Compels indisponível.' }, { status: 503 })
  }
}
