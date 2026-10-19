/**
 * O CONSUMIDOR DA FILA DE ESTOQUE (sf_estoque_envios, migração 0132): reserva um lote, manda um a
 * um ao Compels e grava o resultado na própria linha.
 *
 * O molde é `src/modules/alertas/application/enviar-alertas.ts` — a fila dos Alertas já roda em
 * produção e as duas têm a mesma forma (reserva atômica, tentativas, resultado na linha). As
 * diferenças estão comentadas onde moram; a lista está no cabeçalho da 0132.
 *
 * ⚠️ ENQUANTO O ÚLTIMO METRO NÃO EXISTIR, ESTA FILA ACUMULA E NÃO ESVAZIA. A chamada que fala com o
 * Compels (`infra/compels.ts`) não está implementada — endpoint, autenticação e formato dependem de
 * uma resposta do fornecedor —, então ela devolve falha, e aqui essa falha é tratada como qualquer
 * outra: conta tentativa, guarda o motivo, a linha fica na fila. É ESPERADO, não defeito. Não há
 * nenhum caminho especial para "não configurado" de propósito: no dia em que o compels.ts for
 * escrito, nada neste arquivo muda.
 *
 * Consequência disso para quem for armar o cron (Task 4): cada rodada cobra uma tentativa das linhas
 * que pega, e o teto é 5 — com o último metro ainda em aberto, cinco rodadas bastam para as linhas
 * saírem da fila como falha e só voltarem pelo Reenviar da tela de pendências, uma por uma. Ou seja:
 * a linha do crontab só faz sentido depois que o envio ao ERP existir de verdade.
 *
 * Os TIPOS e as PORTAS moram aqui, e não num `portas.ts` à parte como nos Alertas, porque o plano
 * desta fase nomeia três arquivos (este, o repositório e o compels) e um quarto só para duas
 * interfaces seria um arquivo a mais para achar sem nada a mais para dizer.
 */

/**
 * Uma linha da fila já RESERVADA por esta rodada (`sf_estoque_reservar`): `tentativas` já conta esta
 * tentativa. Os campos são exatamente os que a função devolve — nada é derivado aqui.
 *
 * Em particular, o `alvo` (a identidade do bipe: série normalizada, senão o código da caixa) NÃO
 * aparece: no banco ele é coluna GERADA justamente para que essa escolha não possa divergir do que
 * foi gravado, e recalculá-la em TypeScript reabriria a divergência que a coluna fecha. Se o Compels
 * precisar dela na carga, o certo é acrescentá-la ao `returns table` da sf_estoque_reservar.
 */
export interface EnvioEstoqueReservado {
  id: string
  /** A chave de idempotência que viaja ao ERP (ALMOX/<pmo>/<op>/<posto>/<alvo>/<E|S><n>). */
  chave: string
  operacao: 'entrada' | 'estorno'
  pmo: string
  op: string
  posto: string
  tipo: 'caixa' | 'serie'
  /** O que o coletor leu: código da caixa ou a série crua. */
  bipe: string
  /** Série normalizada; vazia no bipe de caixa. */
  serieNorm: string
  /**
   * Peças da movimentação, SEMPRE POSITIVA — inclusive no estorno. O sinal (ou o tipo de
   * movimentação) é assunto da carga do ERP, montada no último metro: a fila guarda quantas peças
   * são, e `operacao` diz para onde elas vão.
   */
  quantidade: number
  tentativas: number
  criadoEm: string
}

/** Sucesso, ou o motivo da falha em português — é ele que a tela de pendências mostra. */
/**
 * `aguardar`: a falha é uma CONDIÇÃO DE ESPERA e NADA chegou ao ERP (OP em uso, sem empenho, pendência
 * de material, falta de saldo de componente). Quem conclui a linha devolve a tentativa cobrada na
 * reserva e adia a linha uns minutos: esperar o Almoxarifado empenhar não pode gastar as 5 tentativas
 * e jogar centenas de linhas para o Reenviar manual.
 */
export type ResultadoEnvioEstoque = { ok: true } | { ok: false; erro: string; aguardar?: boolean }

/**
 * O último metro, como PORTA: uma função que recebe uma linha da fila e devolve sucesso ou o motivo
 * da falha. Quem implementa é `infra/compels.ts` (hoje, um não-implementado honesto); nos testes
 * entra uma função de mentira — por isso aqui não há `fetch`, nem URL, nem token.
 */
export type PortaCompels = (envio: EnvioEstoqueReservado) => Promise<ResultadoEnvioEstoque>

/**
 * O que uma rodada de reserva trouxe: as linhas que este código entende e QUANTAS o banco devolveu e
 * ele não entendeu.
 *
 * As ilegíveis vêm como CONTAGEM, e não como linhas, porque não há nada a fazer com elas aqui: o
 * repositório já as concluiu como falha (é ele que sabe escrever na linha), e o laço não tem o que
 * mandar ao ERP. Mas a contagem tem que vir, por duas razões que o laço usa logo abaixo, e que sem ela
 * ficavam erradas em silêncio:
 *   • ela é FALHA no resumo. O resumo é o que o cron (Task 4) escreve no log, e é o único olho que
 *     alguém tem nesta fila: uma rodada com uma linha ilegível reportando `falhas: 0` é o log mentindo
 *     sobre a própria rodada;
 *   • ela conta pro LOTE ESTAR CHEIO. "Cheio" quer dizer "o banco tinha mais do que o limite", e isso
 *     se mede pelo que o banco devolveu, não pelo que sobrou depois da leitura — senão um lote cheio
 *     com uma linha ilegível parece incompleto e o laço para antes da hora, deixando fila pra trás.
 */
export interface LoteEstoqueReservado {
  envios: EnvioEstoqueReservado[]
  ilegiveis: number
}

export interface RepositorioEstoqueEnvios {
  /** `sf_estoque_reservar()`: pega um lote da fila de forma atômica (ver a ordem na 0132). */
  reservarPendentes(limite: number): Promise<LoteEstoqueReservado>
  /**
   * Grava o resultado NA PRÓPRIA LINHA reservada (ok/erro/enviado_em) e solta a reserva. Lança em
   * erro de banco — quem chama trata por item.
   */
  concluirEnvio(envio: EnvioEstoqueReservado, resultado: ResultadoEnvioEstoque): Promise<void>
}

export interface ResumoEnvioEstoque {
  enviados: number
  /** Linhas que não chegaram ao ERP nesta rodada — inclusive as que o código não conseguiu ler. */
  falhas: number
  /** Linhas adiadas por condição de espera (não gastaram tentativa). Não são falha. */
  aguardando: number
}

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Tamanho de cada lote reservado. A reserva no banco vale 15 min: 30 x até 20 s cabe com folga. */
export const LIMITE_LOTE = 30

/**
 * Orçamento de tempo de uma chamada de `entregarEstoquePendente`: enquanto o lote vier cheio,
 * reserva o próximo — mas só COMEÇA um lote novo se ainda não passou disso. O que sobrar fica
 * pendente para a próxima rodada do cron.
 */
export const ORCAMENTO_ENTREGA_MS = 40_000

/**
 * O ÚNICO caminho de entrega da fila: reserva um lote no banco (atômico — duas rodadas ao mesmo
 * tempo nunca pegam a mesma linha), manda ao Compels e grava o resultado na linha.
 *
 * ORDEM: o laço entrega o lote na ordem em que ele vem, e NÃO tem regra de par nenhuma — a de que
 * um estorno não sai antes da entrada dele mora no filtro da `sf_estoque_reservar` (0132), porque a
 * reserva é a única porta da fila e porque segurar uma linha aqui, depois de reservada, já teria
 * cobrado a tentativa dela: linha segurada não é linha que falhou. O efeito colateral bom é este
 * laço não precisar saber do assunto, e o segundo consumidor que alguém escrever também não.
 *
 * LOTES: enquanto o lote vier CHEIO, reserva o próximo, até o orçamento (`ORCAMENTO_ENTREGA_MS`).
 * Para antes se o lote trouxe algum REENVIO (tentativas > 1): o banco devolve as novas primeiro,
 * então reenvio no lote quer dizer que as novas acabaram — continuar só gastaria as tentativas de
 * uma linha que acabou de falhar na mesma rodada. Para também se NADA do lote foi entregue (ERP
 * fora do ar, ou o último metro ainda não existir): insistir agora só queimaria tentativas. É esta
 * última condição que segura a rodada em UM lote enquanto o compels.ts for um não-implementado.
 *
 * Um item que dá errado (o ERP lança, o banco não grava o resultado) NÃO derruba a rodada: loga e
 * segue. Se o erro foi durante o envio, a linha é concluída como falha e volta na próxima rodada
 * (até 5 tentativas). Se foi só ao gravar o resultado, a reserva vence em 15 min e a linha volta —
 * entrega "pelo menos uma vez", e é a chave de idempotência que segura o "no máximo uma vez" do
 * lado do ERP.
 */
export async function entregarEstoquePendente(
  compels: PortaCompels,
  repo: RepositorioEstoqueEnvios,
  opcoes: { limite?: number; orcamentoMs?: number; agora?: () => number } = {},
): Promise<ResumoEnvioEstoque> {
  const limite = opcoes.limite ?? LIMITE_LOTE
  const orcamento = opcoes.orcamentoMs ?? ORCAMENTO_ENTREGA_MS
  const agora = opcoes.agora ?? Date.now
  const inicio = agora()

  let enviados = 0
  let falhas = 0
  let aguardando = 0
  // Motivo → quantas linhas: o log diz UMA vez por motivo, e não uma linha por peça (149 bipes à espera do
  // mesmo empenho seriam 149 linhas de log a cada rodada).
  const motivosDeEspera = new Map<string, number>()
  for (;;) {
    let enviadosNoLote = 0
    let aguardandoNoLote = 0
    const { envios: lote, ilegiveis } = await repo.reservarPendentes(limite)
    // A linha que o repositório não entendeu já foi concluída como falha lá, mas a FALHA é da rodada:
    // sem isto o resumo diria `falhas: 0` e o log do cron mentiria sobre a única coisa que alguém lê.
    falhas += ilegiveis

    for (const envio of lote) {
      let resultado: ResultadoEnvioEstoque
      try {
        resultado = await compels(envio)
      } catch (e) {
        // Exceção (rede, JSON quebrado, um `throw` do último metro) é falha de envio como qualquer
        // outra: o motivo vai para a linha e ela volta na próxima rodada. Quem loga é o `else` logo
        // abaixo, um só lugar para os dois caminhos — logar aqui também daria duas linhas para a mesma
        // falha, e quem lê o log contaria falhas em dobro.
        resultado = { ok: false, erro: `Erro interno: ${mensagemDe(e)}` }
      }

      if (resultado.ok) {
        enviados += 1
        enviadosNoLote += 1
      } else if (resultado.aguardar) {
        // Espera, não falha: nada chegou ao ERP e a linha volta daqui a pouco sem gastar tentativa.
        aguardando += 1
        aguardandoNoLote += 1
        motivosDeEspera.set(resultado.erro, (motivosDeEspera.get(resultado.erro) ?? 0) + 1)
      } else {
        // O MOTIVO TEM QUE SAIR NO LOG, e no CAMINHO NORMAL o último metro DEVOLVE a falha — não lança:
        // é assim que o `compels.ts` de hoje diz "não configurado" e é assim que o "o ERP recusou a carga"
        // vai chegar amanhã. Sem esta linha o motivo ia só para a coluna `erro`, e aí o log do cron dizia
        // "o motivo de cada linha saiu acima" com NADA acima: a rodada com falha ficava sem nenhum olho
        // fora da tela de pendências — justo no estado esperado de hoje, em que TODAS falham.
        console.error(`[estoque] envio ${envio.chave} falhou:`, resultado.erro)
        falhas += 1
      }

      try {
        await repo.concluirEnvio(envio, resultado)
      } catch (e) {
        console.error(`[estoque] gravar resultado de ${envio.chave} falhou:`, mensagemDe(e))
      }
    }

    // CHEIO é sobre o que o BANCO devolveu, não sobre o que sobrou depois da leitura: contando só as
    // legíveis, um lote cheio com uma linha ilegível pareceria incompleto e o laço pararia antes da
    // hora, deixando na fila o que caberia nesta rodada.
    const cheio = lote.length + ilegiveis >= limite
    const soNovas = lote.every((e) => e.tentativas <= 1)
    // Um lote em que NADA andou e nada foi adiado (ERP fora do ar, por exemplo) para a rodada: insistir só
    // queimaria tentativas. Se houve linhas adiadas por espera, elas já saíram da fila por alguns minutos
    // e o próximo lote traz linhas diferentes (de outras OPs): continuar é o que evita uma OP à espera
    // travar as demais.
    if (!cheio || !soNovas || (enviadosNoLote === 0 && aguardandoNoLote === 0) || agora() - inicio >= orcamento) break
  }
  for (const [motivo, quantas] of motivosDeEspera) {
    console.log(`[estoque] ${quantas} linha(s) aguardando: ${motivo}`)
  }
  return { enviados, falhas, aguardando }
}
