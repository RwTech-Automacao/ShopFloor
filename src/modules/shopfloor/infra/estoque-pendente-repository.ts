import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import {
  TENTATIVAS_APOS_REENVIO,
  TETO_TENTATIVAS,
  type EntradaDoEstorno,
  type LinhaFilaEstoque,
} from '../domain/estoque-pendente'

/**
 * A infra da TELA de pendências da fila de estoque (sf_estoque_envios, 0132). Nada de regra aqui: a
 * tradução dos estados mora em `domain/estoque-pendente.ts` e a decisão do Reenviar em
 * `application/estoque-pendente-actions.ts`.
 *
 * NENHUMA FUNÇÃO SQL NOVA: a 0132 já deixou o que era preciso — a policy de `select` para quem tem
 * `shopfloor.visualizar` e os índices (`sf_estoque_envios_op`, criado justamente para "a tela de
 * pendências e a leitura por OP"). Duas leituras por tabela resolvem, então não há migração nesta
 * task.
 *
 * A LEITURA vai pelo client da SESSÃO (`createServerSupabase`), e não pelo de `service_role` do
 * consumidor da fila: assim o RBAC da 0132 (`tem_permissao('shopfloor','visualizar')`, a de DOIS
 * argumentos) continua sendo cobrado pelo banco, além do gate da página. É o mesmo desenho da tela
 * de Cancelamentos.
 *
 * A ESCRITA do Reenviar vai pelo client de `service_role`, e não tem como ser de outro jeito: a 0132
 * dá ao `authenticated` só `select` e não criou policy de escrita nenhuma (como em
 * sf_registros_cancelados, 0087) — o navegador nunca escreve nesta tabela. Quem autoriza é o gate de
 * `shopfloor:administrar` na Server Action, antes de chegar aqui.
 */

/** Colunas da fila que a tela usa. `alvo` e `seq_chave` são colunas GERADAS — lidas, nunca escritas. */
const COLUNAS =
  'id, chave, operacao, pmo, op, posto, tipo, bipe, alvo, quantidade, estornado, tentativas,'
  + ' reservado_em, erro, criado_em, entrada_id, seq_chave'

/**
 * A segunda leitura traz a linha INTEIRA da entrada, e não só o estado dela, porque agora ela pode
 * entrar na lista (ver `listarEstoquePendente`). `ok`/`cancelado_em` vêm de fora do `COLUNAS` porque
 * a primeira leitura já filtra por eles e não precisa lê-los.
 */
const COLUNAS_ENTRADA = COLUNAS + ', ok, cancelado_em'

/**
 * Quantos ids por `in (...)`. O PostgREST manda filtro na URL: 200 uuids viram uma linha de pedido de
 * ~7,7 KB, e o `large_client_header_buffers` padrão do nginx é 8 KB — estourá-lo devolveria 4xx, o
 * `throw` daqui derrubaria a tela inteira e não há `error.tsx` em lugar nenhum do projeto. 50 por
 * lote deixa a URL em ~2 KB e tira a dúvida do caminho; o custo é uma requisição a mais por lote.
 */
const IDS_POR_LOTE = 50

function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho))
  return lotes
}

interface LinhaBruta {
  id: string
  chave: string
  operacao: string
  pmo: string
  op: string
  posto: string
  tipo: string
  bipe: string
  alvo: string
  quantidade: number
  estornado: number
  tentativas: number
  reservado_em: string | null
  erro: string | null
  criado_em: string
  entrada_id: string | null
  seq_chave: number | null
}

/**
 * `operacao` e `tipo` são CHECK no banco, mas o tipo de cá não pode confiar num `as`: um valor novo
 * gravado por uma versão futura da RPC chegaria aqui e a tela mostraria um estado errado calada. O
 * desconhecido cai no caso mais conservador — `entrada` (que não é retida pela ordem do par, então
 * não inventa um "esperando a entrada" que não existe) e `caixa`.
 */
function lerOperacao(v: string): LinhaFilaEstoque['operacao'] {
  return v === 'estorno' ? 'estorno' : 'entrada'
}
function lerTipo(v: string): LinhaFilaEstoque['tipo'] {
  return v === 'serie' ? 'serie' : 'caixa'
}

function converter(l: LinhaBruta): LinhaFilaEstoque {
  return {
    id: l.id,
    chave: l.chave,
    operacao: lerOperacao(l.operacao),
    pmo: l.pmo,
    op: l.op,
    posto: l.posto,
    tipo: lerTipo(l.tipo),
    bipe: l.bipe,
    alvo: l.alvo,
    quantidade: Number(l.quantidade ?? 0),
    estornado: Number(l.estornado ?? 0),
    tentativas: Number(l.tentativas ?? 0),
    reservadoEm: l.reservado_em,
    erro: l.erro,
    criadoEm: l.criado_em,
    entradaId: l.entrada_id,
    seqChave: l.seq_chave === null ? null : Number(l.seq_chave),
  }
}

export interface DadosEstoquePendente {
  linhas: LinhaFilaEstoque[]
  /** As ENTRADAS de que os estornos da lista saem, por id. */
  entradas: Map<string, EntradaDoEstorno>
  /** A lista foi cortada pelo limite? (então há mais fila do que a tela mostra.) */
  cortada: boolean
}

/**
 * O QUE NÃO CHEGOU AO ERP: `ok = false` e não cancelada — os estados PENDENTE, RESERVADA e DESISTIU
 * da 0132. O que já foi entregue (`ok`) e o que foi cancelado antes de sair não são pendência: a
 * linha fica na tabela para reconciliação, mas não é sobre ela que alguém age às 7h.
 *
 * A SEGUNDA LEITURA busca as ENTRADAS apontadas pelos estornos da lista, e ela faz DUAS coisas:
 *   • explica o estorno retido — a entrada pode NÃO ser pendência: quando ela já chegou ao ERP
 *     (`ok = true`) o estorno está liberado, e quando ela foi CANCELADA o estorno está retido para
 *     sempre; dois estados opostos que a primeira leitura não distingue, porque nos dois a entrada
 *     está fora dela;
 *   • COMPLETA O PAR — se a entrada ainda é pendência e ficou fora do corte, ela entra na lista.
 */
export async function listarEstoquePendente(limite = 200): Promise<DadosEstoquePendente> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_estoque_envios')
    .select(COLUNAS)
    .eq('ok', false)
    .is('cancelado_em', null)
    // ACIONABILIDADE ANTES DA DATA. Ordenar só por `criado_em desc` esconde exatamente quem a tela
    // existe para mostrar: com o último metro falhando, em 5 rodadas TODA a fila vai para o teto, e
    // as linhas que precisam de gente são as mais ANTIGAS — as primeiras a sair de um corte por
    // data, e nada as tira da lista depois (o Reenviar não as remove da fila e, sem o envio, nada
    // vira `ok`), sem paginação nem filtro para alcançá-las. `tentativas desc` traz primeiro quem
    // está no teto (`>= TETO_TENTATIVAS`, a única situação em que o Reenviar se aplica) e, dentro do
    // mesmo número de tentativas, a data manda como antes.
    .order('tentativas', { ascending: false })
    .order('criado_em', { ascending: false })
    // `limite + 1` só para saber se há mais: a linha extra é descartada e a tela mostra `limite`.
    // Com `>= limite` a frase "há mais na fila" aparecia também na fila de exatamente `limite`.
    .limit(limite + 1)
  if (error) throw error
  const brutas = (data ?? []) as unknown as LinhaBruta[]
  const cortada = brutas.length > limite
  const linhas = brutas.slice(0, limite).map(converter)

  const idsEntradas = [
    ...new Set(
      linhas
        .filter((l) => l.operacao === 'estorno')
        .map((l) => l.entradaId)
        .filter((id): id is string => !!id),
    ),
  ]
  const naLista = new Set(linhas.map((l) => l.id))
  const entradas = new Map<string, EntradaDoEstorno>()
  for (const lote of emLotes(idsEntradas, IDS_POR_LOTE)) {
    const { data: brutasEntradas, error: erroEntradas } = await supabase
      .from('sf_estoque_envios')
      .select(COLUNAS_ENTRADA)
      .in('id', lote)
    if (erroEntradas) throw erroEntradas
    for (const e of (brutasEntradas ?? []) as unknown as (LinhaBruta & {
      ok: boolean; cancelado_em: string | null
    })[]) {
      entradas.set(e.id, {
        id: e.id,
        chave: e.chave,
        ok: e.ok === true,
        canceladoEm: e.cancelado_em,
        tentativas: Number(e.tentativas ?? 0),
      })
      // O PAR NÃO PODE CHEGAR QUEBRADO. O estorno é sempre criado DEPOIS da entrada, então quem cai
      // fora de qualquer corte é a ENTRADA — e é nela que está o botão e a frase "Aperte Reenviar NA
      // LINHA DA ENTRADA (a de cima, neste mesmo bipe)", que não tem como ser cumprida se a linha
      // não foi renderizada. Se a entrada ainda é pendência, ela entra na lista mesmo passando do
      // `limite`: o grupo do bipe vale mais que o número redondo.
      if (e.ok !== true && e.cancelado_em === null && !naLista.has(e.id)) {
        naLista.add(e.id)
        linhas.push(converter(e))
      }
    }
  }

  return { linhas, entradas, cortada }
}

/** O que o Reenviar precisa saber da linha antes de decidir. */
export interface LinhaParaReenvio {
  id: string
  chave: string
  operacao: string
  pmo: string
  op: string
  ok: boolean
  canceladoEm: string | null
  tentativas: number
  reservadoEm: string | null
  quantidade: number
  estornado: number
}

/**
 * Lê a linha pelo id, com o client de `service_role` — a MESMA leitura que a decisão do Reenviar usa
 * e que a escrita logo abaixo cerca. Pelo client da sessão ela também passaria (a policy de select
 * existe), mas então "o que eu li" e "o que eu escrevi" viriam por dois caminhos de permissão
 * diferentes, e um ajuste de RLS amanhã deixaria a ação decidindo sobre uma linha que ela não
 * consegue gravar. Quem autoriza é o gate de `shopfloor:administrar` na Server Action.
 */
export async function lerLinhaParaReenvio(id: string): Promise<LinhaParaReenvio | null> {
  const sb = createServiceSupabase()
  const { data, error } = await sb
    .from('sf_estoque_envios')
    .select('id, chave, operacao, pmo, op, ok, cancelado_em, tentativas, reservado_em, quantidade, estornado')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const l = data as {
    id: string; chave: string; operacao: string; pmo: string; op: string; ok: boolean
    cancelado_em: string | null; tentativas: number; reservado_em: string | null
    quantidade: number; estornado: number
  }
  return {
    id: l.id,
    chave: l.chave,
    operacao: l.operacao,
    pmo: l.pmo,
    op: l.op,
    ok: l.ok === true,
    canceladoEm: l.cancelado_em,
    tentativas: Number(l.tentativas ?? 0),
    reservadoEm: l.reservado_em,
    quantidade: Number(l.quantidade ?? 0),
    estornado: Number(l.estornado ?? 0),
  }
}

/**
 * DEVOLVE A LINHA À FILA: `tentativas = TENTATIVAS_APOS_REENVIO` (1, NUNCA 0 — a razão inteira está
 * na Server Action) e solta a reserva. Não mexe em `quantidade`, `estornado`, `erro` nem `chave`:
 *   • `quantidade`/`estornado` são o que o ERP recebeu e o que já foi devolvido — reenviar não muda
 *     nem um nem outro;
 *   • `erro` fica de propósito, para a tela continuar mostrando o motivo da última falha até a
 *     próxima rodada dar um resultado novo. Limpá-lo esconderia o porquê de a linha estar aqui;
 *   • `chave` é a idempotência: é ela que faz o ERP descartar a repetição se a tentativa anterior
 *     chegou lá com a resposta perdida no caminho. Reenviar com chave nova é o que criaria estoque
 *     dobrado.
 *
 * A CERCA do `update` repete as condições que a ação já conferiu (`ok = false`, não cancelada,
 * `tentativas >= TETO`) porque entre a leitura e a escrita cabe uma rodada do cron: se ela entregou
 * a linha nesse meio, o `update` não casa e devolve zero linha, em vez de ressuscitar como pendente
 * uma linha que acabou de ser entregue. Devolve `true` se gravou.
 */
export async function liberarParaReenvio(id: string): Promise<boolean> {
  const sb = createServiceSupabase()
  const { data, error } = await sb
    .from('sf_estoque_envios')
    .update({ tentativas: TENTATIVAS_APOS_REENVIO, reservado_em: null })
    .eq('id', id)
    .eq('ok', false)
    .is('cancelado_em', null)
    .gte('tentativas', TETO_TENTATIVAS)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}
