import { configBaixaNf, mensagensDeAviso, processarFila } from '@/modules/compels/application/baixar-nfs'
import { filaDoServico } from '@/modules/faturamento/infra/fila-repository'
import { criarDiscord } from '@/modules/alertas/infra/discord'
import { canalDiscordDoSistema } from '@/modules/alertas/infra/canais'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e fala com o ERP: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/** Prefixo de toda linha de log desta rodada — é por ele que se filtra o log do pm2. */
const TAG = '[baixa-nf]'

/** Notas já avisadas neste processo (reinício do app = pode repetir um aviso, nunca perder). */
const jaAvisadas = new Set<string>()

/** Uma rodada por vez neste processo: duas rodadas cruzadas tentariam a MESMA nota da fila. */
let rodando = false

/** Avisa no canal do Discord do sistema (o mesmo bot dos Alertas). Sem bot ou sem canal, só o log. */
async function avisarNoDiscord(mensagens: string[]): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN ?? ''
  const canal = (process.env.COMPELS_BAIXA_NF_DISCORD_CANAL_ID ?? '').trim() || canalDiscordDoSistema()
  if (!token || !canal || mensagens.length === 0) return
  const dc = criarDiscord({ token })
  for (const texto of mensagens) {
    const r = await dc.enviarCanal(canal, texto, null).catch((e: unknown) => ({ ok: false as const, erro: String(e) }))
    if (!r.ok) console.error(`${TAG} aviso no Discord falhou:`, r.erro)
  }
}

/**
 * FILA DA BAIXA DE NF (spec 2026-11-17-faturamento-baixa-nf-design.md): percorre em ordem as notas que alguém
 * colocou na fila pela tela do Faturamento e baixa as que já têm saldo. Só baixa o que foi selecionado — não
 * olha as outras pendentes. Chamada pelo crontab da instância com o MESMO segredo e o mesmo arquivo de
 * cabeçalho do cron de estoque:
 *   curl -fsS -m 300 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/compels/baixa-nf
 *
 * Desligada sem `COMPELS_BAIXA_NF` (`simular` ou `1`). Lê e grava a fila com a service role. Avisos no canal do
 * Discord do sistema (DISCORD_CANAL_ID, ou COMPELS_BAIXA_NF_DISCORD_CANAL_ID para um canal próprio).
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ESTOQUE_CRON_SECRET ?? ''
  if (esperado === '') return Response.json({ erro: 'Cron não configurado neste ambiente.' }, { status: 503 })
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) return Response.json({ erro: 'Não autorizado.' }, { status: 401 })

  const config = configBaixaNf()
  if (!config) return Response.json({ desligada: true })

  if (rodando) return Response.json({ ocupado: true })
  rodando = true
  try {
    const resumo = await processarFila(new ClienteCompels(configDoAmbiente()), filaDoServico(), config)
    const agora = new Date().toISOString()
    for (const n of resumo.notas) {
      const linha = `${TAG} ${agora} ${resumo.modo} NF ${n.numero}: ${n.resultado} — ${n.detalhe}`
      if (n.resultado === 'falhou' || n.resultado === 'falha') console.error(linha)
      else console.log(linha)
    }
    await avisarNoDiscord(mensagensDeAviso(resumo, jaAvisadas))
    console.log(`${TAG} ${agora} rodada (${resumo.modo}): ${resumo.notas.length} nota(s) na fila`)
    return Response.json(resumo)
  } catch (e) {
    const motivo = e instanceof Error ? e.message : String(e)
    console.error(`${TAG} ${new Date().toISOString()} rodada não aconteceu:`, motivo)
    return Response.json({ erro: 'Compels ou fila indisponível.' }, { status: 503 })
  } finally {
    rodando = false
  }
}
