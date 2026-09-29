/**
 * A LEITURA HUMANA DA FILA DE ESTOQUE (sf_estoque_envios, migração 0132).
 *
 * A fila não tem coluna de estado: tudo sai de `ok`/`tentativas`/`reservado_em`/`cancelado_em` (a
 * lista está no cabeçalho da 0132). Este arquivo traduz essa combinação para o que uma pessoa lê às
 * 7h da manhã sem contexto: o que aconteceu com a linha e o que ela tem de fazer a respeito.
 *
 * Aqui não há banco nem React de propósito — a regra de "que estado é este" é a parte que precisa de
 * teste, e ela é a mesma leitura que o predicado da `sf_estoque_reservar` faz de dentro do banco,
 * vista de fora.
 */

/**
 * O teto de tentativas da `sf_estoque_reservar` e do índice parcial `sf_estoque_envios_pendentes`.
 * Ele está repetido aqui porque é ele que decide se a linha AINDA VOLTA sozinha ou se ela já saiu da
 * fila e só uma pessoa a destrava. Mexer no teto no banco é mexer neste número também.
 */
export const TETO_TENTATIVAS = 5

/** A janela de reserva da `sf_estoque_reservar`: dentro dela, uma rodada está entregando a linha. */
export const MINUTOS_DE_RESERVA = 15

/**
 * A que valor de `tentativas` o Reenviar devolve a linha. NÃO É ZERO, e a razão é a decisão mais
 * importante desta tela — está escrita inteira em `application/estoque-pendente-actions.ts`, junto
 * da ação que a aplica. Resumo: `tentativas > 0` é a marca de "linha tocada" que a
 * `sf_estoque_reverter` usa para ESTORNAR em vez de ajustar/cancelar; zerar essa marca reabriria o
 * ajuste numa linha que pode já ter chegado ao ERP. 1 é o menor valor que devolve a linha à fila
 * (1 < TETO_TENTATIVAS) sem apagar a marca.
 */
export const TENTATIVAS_APOS_REENVIO = 1

/**
 * A rota da tela. Ela mora AQUI, e não junto da Server Action que a revalida, porque um módulo
 * `'use server'` só pode exportar funções async: uma constante exportada lá faz o Next recusar o
 * módulo inteiro ("Export ... doesn't exist in target module" no build).
 */
export const ROTA_ESTOQUE_PENDENTE = '/shopfloor/analisar/estoque-pendente'

/** Uma linha da fila como ela está no banco (nomes em camelCase; nada derivado). */
export interface LinhaFilaEstoque {
  id: string
  chave: string
  operacao: 'entrada' | 'estorno'
  pmo: string
  op: string
  posto: string
  tipo: 'caixa' | 'serie'
  /** O que o coletor leu: código da caixa ou a série crua. */
  bipe: string
  /** A identidade do bipe (coluna GERADA no banco): série normalizada, senão o código da caixa. */
  alvo: string
  /** Peças da movimentação, sempre positiva — inclusive no estorno (ver a 0132). */
  quantidade: number
  /** Quanto DESTA entrada já virou saída no ERP. Sempre 0 num estorno. */
  estornado: number
  tentativas: number
  /** ISO, ou null se nenhuma rodada reservou a linha desde a última conclusão. */
  reservadoEm: string | null
  /** O motivo do ÚLTIMO erro, em português. Nulo na linha que nunca foi tentada. */
  erro: string | null
  criadoEm: string
  /** De quem este estorno sai (o par GRAVADO pela `sf_estoque_reverter`). Nulo na entrada. */
  entradaId: string | null
  /** O `<n>` da chave (E<n>/S<n>), materializado no banco. Nulo em chave fora do padrão. */
  seqChave: number | null
}

/**
 * O pouco que se precisa saber da ENTRADA de um estorno para explicar por que ele está retido. Vem
 * de uma segunda leitura, porque a entrada pode não estar na lista de pendências — quando ela já
 * chegou ao ERP (`ok`), ou quando foi CANCELADA, ela não é pendência nenhuma, mas continua sendo a
 * explicação do estorno.
 */
export interface EntradaDoEstorno {
  id: string
  chave: string
  ok: boolean
  canceladoEm: string | null
  tentativas: number
}

/**
 * O estado da linha, na ordem em que a tela decide. Cada um é uma frase diferente para o gestor:
 *   • `enviando`          — uma rodada está entregando a linha AGORA (reserva viva). Não se mexe.
 *   • `fora_da_fila`      — gastou o teto de tentativas e a reserva não a escolhe mais. É a única
 *                           que o Reenviar resolve.
 *   • `esperando_entrada` — ESTORNO retido de propósito enquanto a entrada dele não estiver `ok`
 *                           (senão o Compels receberia a saída antes da entrada). Não falhou: tem
 *                           `tentativas = 0` e `erro` nulo, e é justamente por ser indistinguível de
 *                           uma linha nova que dois defeitos passaram pelas revisões das Tasks 2-4.
 *   • `vai_tentar`        — já falhou, ainda tem tentativa: a próxima rodada insiste sozinha.
 *   • `na_fila`           — nunca foi tentada.
 */
export type SituacaoEstoque =
  | 'enviando'
  | 'fora_da_fila'
  | 'esperando_entrada'
  | 'vai_tentar'
  | 'na_fila'

/** Uma linha já traduzida: o estado, o rótulo, o que fazer, o saldo e se o Reenviar se aplica. */
export interface LinhaEstoquePendente extends LinhaFilaEstoque {
  situacao: SituacaoEstoque
  /** O rótulo curto do selo. */
  rotulo: string
  /** A frase que diz o que a pessoa tem de fazer — inclusive "nada", quando é nada. */
  oQueFazer: string
  /**
   * O que esta movimentação vale HOJE. Na entrada é `quantidade - estornado`: uma entrada de 3 com 2
   * estornados vale 1 peça, e mostrar só a quantidade faz o gestor ler 3 onde há 1. No estorno é a
   * própria quantidade (estorno não se estorna).
   */
  saldo: number
  podeReenviar: boolean
}

/**
 * As linhas de UM bipe. O agrupamento é por `pmo/op/posto/alvo` — a identidade do bipe, a mesma que
 * a chave de idempotência usa — porque o que o gestor decide é sobre O PAR, não sobre uma linha:
 * uma entrada que estourou o teto segura o estorno dela PARA SEMPRE (a `sf_estoque_reservar` não
 * entrega estorno antes de a entrada estar `ok`), e só um Reenviar humano NA ENTRADA destrava os
 * dois. Ver o par separado em duas partes da tela seria pedir para a pessoa não achar a ligação.
 */
export interface GrupoEstoquePendente {
  /** `pmo|op|posto|alvo` — chave de React e identidade do grupo. */
  id: string
  pmo: string
  op: string
  posto: string
  alvo: string
  tipo: 'caixa' | 'serie'
  linhas: LinhaEstoquePendente[]
}

/** A reserva ainda vale? (a mesma janela de 15 min da `sf_estoque_reservar`.) */
export function temReservaViva(linha: LinhaFilaEstoque, agora: Date): boolean {
  if (!linha.reservadoEm) return false
  const reservado = new Date(linha.reservadoEm).getTime()
  if (!Number.isFinite(reservado)) return false
  return reservado >= agora.getTime() - MINUTOS_DE_RESERVA * 60_000
}

/**
 * ESTE ESTORNO ESTÁ RETIDO PELA ORDEM DO PAR? É a mesma leitura do predicado da
 * `sf_estoque_reservar`, vista de fora: estorno cuja entrada GRAVADA (`entrada_id`) não está `ok`.
 *
 * O `entrada_id` nulo, ou apontando para linha que não veio na leitura, também conta como retido —
 * é a mesma escolha do `coalesce(..., false)` do predicado: sem saber se a entrada saiu, SEGURA.
 * Liberar mandaria ao ERP uma saída de peça que ele nunca recebeu.
 */
export function esperaAEntrada(
  linha: LinhaFilaEstoque,
  entradas: Map<string, EntradaDoEstorno>,
): boolean {
  if (linha.operacao !== 'estorno') return false
  const entrada = linha.entradaId ? entradas.get(linha.entradaId) : undefined
  return !entrada?.ok
}

/** O selo e a frase de cada estado. O texto do `esperando_entrada` depende da entrada, ver abaixo. */
const ROTULOS: Record<SituacaoEstoque, string> = {
  enviando: 'Enviando agora',
  fora_da_fila: 'Fora da fila',
  esperando_entrada: 'Esperando a entrada',
  vai_tentar: 'Vai tentar de novo',
  na_fila: 'Na fila',
}

/**
 * A frase do estorno retido, que muda com o ESTADO DA ENTRADA — as quatro são situações diferentes
 * e três delas exigem gestos diferentes:
 *   • entrada ainda na fila            → não há nada a fazer, a espera termina sozinha;
 *   • entrada fora da fila (teto)      → o par está parado esperando UMA PESSOA: é o Reenviar NA
 *                                        ENTRADA que destrava, e não o desta linha;
 *   • entrada CANCELADA                → ela nunca vai virar `ok` (o check da tabela proíbe), então
 *                                        este estorno ficaria retido para sempre. Só alcançável
 *                                        afrouxando A ASSIMETRIA da 0132 ou por mão humana no banco;
 *   • sem entrada vinculada / não achada → só alcançável por `insert` à mão no SQL Editor depois de
 *                                        derrubar o CHECK. Ninguém sabe o que esta saída desfaz.
 */
function oQueFazerEsperandoAEntrada(entrada: EntradaDoEstorno | undefined): string {
  if (!entrada) {
    return 'Esta saída não tem entrada vinculada, então não há como saber o que ela desfaz — e por '
      + 'isso ela nunca vai ao ERP. Não aperte Reenviar: chame o desenvolvedor, porque isto só '
      + 'acontece por alteração à mão no banco.'
  }
  if (entrada.canceladoEm) {
    return 'A entrada deste bipe foi CANCELADA e nunca vai chegar ao Compels, então esta saída '
      + 'ficaria retida para sempre. Chame o desenvolvedor: precisa de análise no banco.'
  }
  if (entrada.tentativas >= TETO_TENTATIVAS) {
    return 'Esta saída só pode ir ao Compels depois que a entrada do mesmo bipe chegar lá, e a '
      + 'entrada gastou as tentativas. Aperte Reenviar NA LINHA DA ENTRADA (a de cima, neste mesmo '
      + 'bipe): quando ela chegar, esta saída sai sozinha na rodada seguinte.'
  }
  return 'Nada aqui: esta saída espera a entrada do mesmo bipe chegar ao Compels primeiro (senão o '
    + 'ERP receberia a saída antes da entrada). A entrada ainda está na fila.'
}

function oQueFazer(
  situacao: SituacaoEstoque,
  linha: LinhaFilaEstoque,
  entrada: EntradaDoEstorno | undefined,
): string {
  switch (situacao) {
    case 'enviando':
      return `Nada: uma rodada de envio está entregando esta linha agora. Se ela falhar, o motivo `
        + `aparece aqui em até ${MINUTOS_DE_RESERVA} minutos.`
    case 'fora_da_fila':
      return `Gastou as ${TETO_TENTATIVAS} tentativas e saiu da fila — ela não volta sozinha. `
        + `Aperte Reenviar para colocá-la de novo na fila; se o erro for sempre o mesmo, é ele que `
        + `precisa ser resolvido antes.`
    case 'esperando_entrada':
      return oQueFazerEsperandoAEntrada(entrada)
    case 'vai_tentar': {
      const faltam = TETO_TENTATIVAS - linha.tentativas
      return `Nada: a próxima rodada tenta de novo (${faltam} de ${TETO_TENTATIVAS} tentativas `
        + `ainda por gastar).`
    }
    case 'na_fila':
      return 'Nada: esta linha ainda não foi tentada nenhuma vez. A próxima rodada de envio a leva.'
  }
}

/**
 * O ESTADO DE UMA LINHA, e a ordem em que ele é decidido — a ordem importa e cada degrau tem razão:
 *
 *  1. RESERVA VIVA vem primeiro porque é o único estado em que MEXER É ERRADO: soltar a reserva de
 *     uma linha que uma rodada está entregando deixa outra rodada pegar a mesma linha (a janela de
 *     15 min existe justamente para o cron atrasado e um Reenviar não mandarem a mesma entrada
 *     duas vezes — ver a `sf_estoque_reservar`).
 *  2. FORA DA FILA (teto) vem antes do estorno retido porque é TERMINAL: a linha não volta sozinha
 *     de jeito nenhum, então é isso que a pessoa tem de saber primeiro. Na prática as duas não se
 *     cruzam — um estorno retido nunca é reservado, logo nunca paga tentativa, e fica em
 *     `tentativas = 0` (é o que o teste 17 da 0132 prova) —, mas se um dia se cruzarem, "gastou as
 *     tentativas" é a informação que exige alguém.
 *  3. ESTORNO RETIDO antes de `vai_tentar`/`na_fila`: sem este degrau ele apareceria como linha nova
 *     qualquer, e foi essa invisibilidade que escondeu dois defeitos das revisões anteriores.
 */
export function situacaoDaLinha(
  linha: LinhaFilaEstoque,
  entradas: Map<string, EntradaDoEstorno>,
  agora: Date,
): SituacaoEstoque {
  if (temReservaViva(linha, agora)) return 'enviando'
  if (linha.tentativas >= TETO_TENTATIVAS) return 'fora_da_fila'
  if (esperaAEntrada(linha, entradas)) return 'esperando_entrada'
  if (linha.tentativas > 0) return 'vai_tentar'
  return 'na_fila'
}

/**
 * O Reenviar serve para UM estado só: a linha que saiu da fila pelo teto de tentativas. É a única
 * que não volta sozinha e a única em que colocá-la de novo na fila é a coisa certa.
 *   • `enviando`          — soltar a reserva permitiria duas rodadas entregarem a mesma linha;
 *   • `vai_tentar`/`na_fila` — já estão na fila; o botão só daria a impressão de ter feito algo;
 *   • `esperando_entrada` — o que a destrava é a ENTRADA dela, não ela. Um Reenviar aqui não muda
 *     nada (o predicado do par continuaria segurando) e faria a pessoa achar que resolveu.
 */
export function podeReenviar(situacao: SituacaoEstoque): boolean {
  return situacao === 'fora_da_fila'
}

function traduzir(
  linha: LinhaFilaEstoque,
  entradas: Map<string, EntradaDoEstorno>,
  agora: Date,
): LinhaEstoquePendente {
  const situacao = situacaoDaLinha(linha, entradas, agora)
  const entrada = linha.entradaId ? entradas.get(linha.entradaId) : undefined
  return {
    ...linha,
    situacao,
    rotulo: ROTULOS[situacao],
    oQueFazer: oQueFazer(situacao, linha, entrada),
    // Estorno não tem saldo próprio: `estornado` é uma coluna da ENTRADA e nasce 0 nele.
    saldo: linha.operacao === 'entrada' ? linha.quantidade - linha.estornado : linha.quantidade,
    podeReenviar: podeReenviar(situacao),
  }
}

/**
 * Monta os grupos da tela: traduz cada linha e junta as do MESMO bipe (`pmo/op/posto/alvo`).
 *
 * Ordem dos grupos: PRIMEIRO os que pedem um gesto (algum Reenviar possível — a linha que saiu da
 * fila e não volta sozinha), depois o bipe mais recente (pelo `criado_em` mais novo do grupo). A
 * acionabilidade vem antes da data porque, com o envio ao Compels falhando, o que precisa de gente
 * são justamente as linhas MAIS ANTIGAS: ordenar só por data as empurra para o fim de uma tela sem
 * paginação nem filtro. Entre grupos igualmente acionáveis (ou igualmente inertes) a data manda, que
 * é o que casa com quem abre a tela procurando o que acabou de acontecer.
 *
 * Dentro do grupo a ENTRADA vem antes dos estornos dela, e os estornos em ordem de chave (`S1`,
 * `S2`...): é a ordem dos fatos, e é ela que faz "reenvie a entrada, a de cima" ser uma instrução
 * verdadeira.
 */
export function agruparEstoquePendente(
  linhas: LinhaFilaEstoque[],
  entradas: Map<string, EntradaDoEstorno>,
  agora: Date = new Date(),
): GrupoEstoquePendente[] {
  const grupos = new Map<string, GrupoEstoquePendente>()
  for (const linha of linhas) {
    const id = [linha.pmo, linha.op, linha.posto, linha.alvo].join('|')
    let grupo = grupos.get(id)
    if (!grupo) {
      grupo = { id, pmo: linha.pmo, op: linha.op, posto: linha.posto, alvo: linha.alvo, tipo: linha.tipo, linhas: [] }
      grupos.set(id, grupo)
    }
    grupo.linhas.push(traduzir(linha, entradas, agora))
  }

  const ordemOperacao = (o: 'entrada' | 'estorno') => (o === 'entrada' ? 0 : 1)
  for (const grupo of grupos.values()) {
    grupo.linhas.sort(
      (a, b) =>
        ordemOperacao(a.operacao) - ordemOperacao(b.operacao)
        // `seq_chave` nulo (chave fora do padrão) vai para o fim, como no `nulls last` do banco.
        || (a.seqChave ?? Number.MAX_SAFE_INTEGER) - (b.seqChave ?? Number.MAX_SAFE_INTEGER)
        || a.criadoEm.localeCompare(b.criadoEm),
    )
  }

  const maisNovo = (g: GrupoEstoquePendente) =>
    g.linhas.reduce((max, l) => (l.criadoEm > max ? l.criadoEm : max), '')
  const pedeGesto = (g: GrupoEstoquePendente) => (g.linhas.some((l) => l.podeReenviar) ? 0 : 1)
  return [...grupos.values()].sort(
    (a, b) => pedeGesto(a) - pedeGesto(b) || maisNovo(b).localeCompare(maisNovo(a)),
  )
}
