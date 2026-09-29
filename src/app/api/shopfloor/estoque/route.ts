import { entregarEstoquePendente } from '@/modules/shopfloor/application/enviar-estoque'
import { enviarMovimentacaoCompels } from '@/modules/shopfloor/infra/compels'
import { criarRepositorioEstoqueEnvios } from '@/modules/shopfloor/infra/estoque-envios-repository'
/**
 * A comparação em tempo constante do cron dos Alertas, reaproveitada de propósito: é exatamente a
 * mesma pergunta (um segredo de crontab que chega num cabeçalho `Bearer`), a função não tem nada de
 * específico dos alertas — só compara bytes — e uma segunda implementação dela seria uma segunda
 * chance de escrever um `===` que vaza o tamanho do segredo.
 */
import { segredoConfere } from '@/modules/alertas/infra/assinatura'

/** Depende do cabeçalho e escreve no banco: nunca pode ser servida de cache. */
export const dynamic = 'force-dynamic'

/** Prefixo de toda linha de log desta fila — é por ele que alguém filtra o log do pm2. */
const TAG = '[estoque]'

/**
 * A rodada tem que se datar sozinha: o log do pm2 só ganha horário se alguém tiver configurado
 * `log_date_format`, e às 7h da manhã a pergunta é sempre "isso é de hoje?".
 */
function agoraLegivel(): string {
  return new Date().toISOString()
}

/**
 * ENTREGA DA FILA DE ESTOQUE AO COMPELS — chamada pelo crontab da instância (segredo num arquivo de
 * cabeçalho 600, nunca no argv — ver tools/estoque/README.md §3):
 *   curl -fsS -m 90 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/shopfloor/estoque
 *
 * ⚠️ A LINHA DO CRONTAB SÓ DEVE SER ARMADA DEPOIS QUE `infra/compels.ts` EXISTIR DE VERDADE. Hoje o
 * último metro devolve falha, e cada rodada cobra uma tentativa de cada linha que pega: com o teto
 * de 5, cinco rodadas põem a fila inteira no teto e a volta passa a ser uma linha por vez, no
 * Reenviar da tela de pendências. O motivo completo está no README, seção 3.
 *
 * Com o RDS desligado (plano de economia, `docs/operacao/plano-economia-aws.md`) responde 503 e
 * registra uma linha dizendo que isso é esperado — não é alarme, e ninguém precisa ser acordado.
 */
export async function POST(request: Request): Promise<Response> {
  const esperado = process.env.ESTOQUE_CRON_SECRET ?? ''
  if (esperado === '') {
    // Mesma decisão do cron dos Alertas: ambiente sem o segredo não é ambiente que entrega fila, e
    // 503 (indisponível) diz isso melhor que 401 (que faria parecer que o segredo do crontab está
    // errado). O log é o que separa as duas leituras para quem for procurar.
    console.error(
      `${TAG} ${agoraLegivel()} rodada não aconteceu: ESTOQUE_CRON_SECRET não está no ambiente`
        + ' (o envio ao Compels não está configurado aqui). Nada foi lido nem enviado.',
    )
    return Response.json({ erro: 'Envio de estoque não configurado neste ambiente.' }, { status: 503 })
  }

  // Só o formato `Bearer <segredo>`: o segredo cru, sem o prefixo, também é recusado.
  const recebido = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ?? null
  if (!segredoConfere(recebido, esperado)) {
    return Response.json({ erro: 'Não autorizado.' }, { status: 401 })
  }

  try {
    const repo = criarRepositorioEstoqueEnvios()
    const resumo = await entregarEstoquePendente(enviarMovimentacaoCompels, repo)
    const linha = `${TAG} ${agoraLegivel()} rodada: ${resumo.enviados} enviado(s), ${resumo.falhas} falha(s)`
    // A rodada COM falha sai na mesma saída (stderr) em que o laço acabou de escrever o motivo de
    // cada linha: quem abre o log de erro às 7h lê os motivos e, logo abaixo, de quantas rodadas
    // eles são. A rodada limpa vai pro stdout para não encher o log de erro de linha boa.
    if (resumo.falhas > 0) console.error(`${linha} — o motivo de cada linha saiu acima`)
    else console.log(linha)
    return Response.json(resumo)
  } catch (e) {
    // Banco fora é o caminho NORMAL fora do horário: o RDS é desligado pelo plano de economia e o
    // cron roda só na janela em que ele está ligado. Fica dito na linha para ninguém tratar isso
    // como incidente — e 503 é o que faz o `curl -f` do crontab registrar e ir embora.
    console.error(
      `${TAG} ${agoraLegivel()} rodada não aconteceu: banco indisponível — ESPERADO fora do horário`
        + ' (o RDS é desligado pelo plano de economia); não é alarme. Motivo:',
      e instanceof Error ? e.message : e,
    )
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503 })
  }
}
