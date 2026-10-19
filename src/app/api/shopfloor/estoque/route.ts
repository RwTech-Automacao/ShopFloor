import { entregarEstoquePendente } from '@/modules/shopfloor/application/enviar-estoque'
import { criarPortaCompels } from '@/modules/shopfloor/infra/compels'
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
 * Pedacinhos que aparecem na mensagem de quem NÃO CONSEGUIU CHEGAR ao banco: códigos de erro do
 * Node/undici, o `TypeError: fetch failed` com que o supabase-js embala a falha de rede, e as
 * palavras que o Postgres e o pooler usam quando a conexão não sobe. Comparação em minúsculas.
 *
 * A lista é deliberadamente generosa: errar para "parece conexão" só deixa de marcar uma linha, e
 * errar para o outro lado manda alguém investigar o RDS dormindo — o que treina a pessoa a ignorar a
 * marca, que é o único jeito de perder um bug de verdade aqui.
 */
const SINAIS_DE_CONEXAO = [
  'econnrefused', 'econnreset', 'etimedout', 'enotfound', 'ehostunreach', 'enetunreach',
  'eai_again', 'epipe', 'socket hang up', 'fetch failed', 'network', 'timeout', 'timed out',
  'connection', 'conexão', 'server closed', 'terminating connection', 'too many clients',
]

/**
 * A exceção PARECE o RDS desligado? É palpite, e está escrito como palpite: a única coisa que a
 * rota sabe é o texto do erro. O que ele decide é só o RÓTULO da linha do log — a resposta é 503
 * de qualquer jeito, porque acordar alguém de madrugada é pior que uma rodada perdida.
 */
function pareceFalhaDeConexao(e: unknown): boolean {
  const texto = (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).toLowerCase()
  // `cause` é onde o `fetch failed` guarda o código de verdade (ECONNREFUSED e companhia).
  const causa = e instanceof Error && e.cause ? String((e.cause as { message?: string }).message ?? e.cause) : ''
  const tudo = `${texto} ${causa.toLowerCase()}`
  return SINAIS_DE_CONEXAO.some((sinal) => tudo.includes(sinal))
}

/**
 * ENTREGA DA FILA DE ESTOQUE AO COMPELS — chamada pelo crontab da instância (segredo num arquivo de
 * cabeçalho 600, nunca no argv — ver tools/estoque/README.md §3):
 *   curl -fsS -m 90 -X POST -H @$HOME/.estoque-cron-header http://127.0.0.1:3000/api/shopfloor/estoque
 *
 * ⚠️ A LINHA DO CRONTAB SÓ DEVE SER ARMADA DEPOIS QUE `infra/compels.ts` EXISTIR DE VERDADE. Hoje o
 * último metro devolve falha, e cada rodada cobra uma tentativa de cada linha que pega: com o teto
 * de 5, cada rodada zera as tentativas de até 30 linhas (um lote) e a linha no teto sai da fila: a
 * volta dela passa a ser uma por vez, no Reenviar da tela de pendências. O motivo completo, com a
 * conta de quantas rodadas isso leva, está no README, seção 0.
 *
 * Com o RDS desligado (plano de economia, `docs/operacao/plano-economia-aws.md`) responde 503 e
 * registra uma linha dizendo que isso é esperado — não é alarme, e ninguém precisa ser acordado.
 * Mas só quando a falha PARECE de conexão: qualquer outra exceção também dá 503 (ver o catch) e aí a
 * linha do log é marcada `INESPERADO`, porque "é só o RDS dormindo" seria um diagnóstico inventado.
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
    const resumo = await entregarEstoquePendente(criarPortaCompels(), repo)
    const linha = `${TAG} ${agoraLegivel()} rodada: ${resumo.enviados} enviado(s), ${resumo.falhas} falha(s), ${resumo.aguardando} aguardando`
    // A rodada COM falha sai na mesma saída (stderr) em que o motivo de cada falha acabou de ser
    // escrito: quem abre o log de erro às 7h lê os motivos e, logo abaixo, de quantas rodadas eles
    // são. A rodada limpa vai pro stdout para não encher o log de erro de linha boa.
    //
    // A cauda diz DE ONDE vem o motivo porque não é de um lugar só: a linha que não chegou ao ERP é
    // logada pelo laço (`[estoque] envio <chave> falhou:`) e a que o código não entendeu, pelo
    // repositório (`[estoque] linha da fila ilegível`... ver estoque-envios-repository.ts). Prometer
    // "uma linha por falha" seria mentira nos dois sentidos — uma falha de envio que TAMBÉM falha ao
    // gravar o resultado escreve duas.
    if (resumo.falhas > 0) console.error(`${linha} — cada falha escreveu o motivo dela acima`)
    else console.log(linha)
    return Response.json(resumo)
  } catch (e) {
    // TODA exceção daqui vira 503, de propósito: banco fora é o caminho NORMAL fora do horário (o RDS
    // é desligado pelo plano de economia e o cron roda só na janela em que ele está ligado), e um 500
    // às 3h da manhã acordaria alguém para nada. O 503 também é o que faz o `curl -f` do crontab
    // registrar e ir embora.
    //
    // MAS O RÓTULO NÃO PODE AFIRMAR O QUE A ROTA NÃO SABE. Um bug de refatoração ("x is not a
    // function") cai aqui igual, e a linha dizendo "ESPERADO … não é alarme" ficaria idêntica à de uma
    // noite de RDS dormindo — mandando justamente não investigar. Então: se a mensagem parece falha
    // de conexão, o texto de "esperado"; se não parece, `INESPERADO`, que é a palavra por onde se
    // FILTRA o log (`pm2 logs shopfloor --err | grep INESPERADO`, README §5) para achar as rodadas
    // que merecem alguém olhando sem ler todas.
    const motivo = e instanceof Error ? e.message : String(e)
    const rotulo = pareceFalhaDeConexao(e)
      ? 'banco indisponível — ESPERADO fora do horário (o RDS é desligado pelo plano de economia);'
        + ' não é alarme.'
      : 'INESPERADO — a falha NÃO parece de conexão, então provavelmente não é o RDS desligado;'
        + ' PEDE INVESTIGAÇÃO (a fila não andou).'
    console.error(`${TAG} ${agoraLegivel()} rodada não aconteceu: ${rotulo} Motivo:`, motivo)
    return Response.json({ erro: 'Banco indisponível.' }, { status: 503 })
  }
}
