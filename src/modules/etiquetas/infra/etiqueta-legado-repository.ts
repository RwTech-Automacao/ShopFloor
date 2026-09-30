import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import {
  LIMITE_LINHAS_LEGADO,
  type ConferenciaLegado,
  type EtiquetaLegadoEmitida,
  type RoloEtiquetado,
} from '../domain/partnumber-legado'

/**
 * Acesso a dado das etiquetas do estoque legado (migração 0126). Tudo passa pelas funções
 * `etq_legado_*` (security definer): é o BANCO que atribui o sequencial, numa transação só, e o
 * índice único de (item, sequencial) é a garantia de que dois rolos nunca recebem o mesmo código.
 * A tabela não tem policy de insert — não existe caminho para gravar por fora.
 */

/**
 * Um rolo a etiquetar, do jeito que vai para o banco: é tudo o que sai do navegador (a planilha
 * não sobe).
 *
 * As duas origens mandam campos diferentes, e é por isso que só o `item` é obrigatório: a
 * etiquetagem por planilha sabe a LOCAÇÃO e não sabe o pedido; o inventário rotativo sabe o PEDIDO
 * (está escrito no rolo) e não sabe a locação. `etq_legado_emitir` trata o que falta como ''.
 */
export interface ParLegado {
  item: string
  locacao?: string
  /** Só dígitos, já normalizado pelo domínio. Ausente ou '' = o rolo não tem pedido escrito. */
  pedido?: string
}

interface ConferenciaRpc {
  item: string
  locacao: string
  emitidas_na_locacao: number
  ultima_na_locacao: string | null
  ultimo_sequencial: number
}

interface EmitidaRpc {
  ordem: number
  item: string
  sequencial: number
  codigo: string
  locacao: string
  pedido: string | null
}

/** Uma linha da tabela, como o `select` abaixo pede. */
interface RoloRow {
  id: string
  item: string
  pedido: string | null
  sequencial: number
  codigo: string
  usuario_nome: string | null
  created_at: string
  impressa_em: string | null
}

/** As colunas que a tela do inventário rotativo usa. Uma só lista, para as duas leituras não divergirem. */
const COLUNAS_ROLO = 'id,item,pedido,sequencial,codigo,usuario_nome,created_at,impressa_em'

function paraRolo(l: RoloRow): RoloEtiquetado {
  return {
    id: l.id,
    item: l.item,
    pedido: l.pedido ?? '',
    sequencial: Number(l.sequencial ?? 0),
    codigo: l.codigo,
    usuarioNome: l.usuario_nome ?? '',
    criadoEm: l.created_at,
    impressaEm: l.impressa_em,
  }
}

export interface ResumoLegado {
  totalEtiquetas: number
  totalItens: number
  /** Data da última emissão (ISO), ou null se nada foi etiquetado ainda. */
  ultima: string | null
}

/** O que já foi etiquetado para os pares da planilha (prévia): repetição, data e onde o contador está. */
export async function conferirParesLegado(pares: ParLegado[]): Promise<ConferenciaLegado[]> {
  if (pares.length === 0) return []

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_conferir', { p_linhas: pares })
  if (error) throw error

  return ((data ?? []) as ConferenciaRpc[]).map((c) => ({
    item: c.item,
    locacao: c.locacao,
    emitidasNaLocacao: Number(c.emitidas_na_locacao ?? 0),
    ultimaNaLocacao: c.ultima_na_locacao,
    ultimoSequencial: Number(c.ultimo_sequencial ?? 0),
  }))
}

/**
 * Emite as etiquetas: grava uma linha por rolo e devolve o sequencial que cada uma recebeu, com a
 * `ordem` em que foi enviada (a ordem da planilha, que é a ordem em que as etiquetas serão coladas).
 */
export async function emitirEtiquetasLegado(pares: ParLegado[]): Promise<EtiquetaLegadoEmitida[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_emitir', { p_linhas: pares })
  if (error) throw error

  const linhas = (data ?? []) as EmitidaRpc[]
  // Guarda contra resposta cortada (o PostgREST limita em max_rows): melhor falhar do que gerar um
  // arquivo com menos etiquetas do que o banco emitiu — seriam rolos sem etiqueta e códigos gastos.
  if (linhas.length !== pares.length) {
    throw new Error(
      `O banco emitiu ${linhas.length} etiqueta(s) para ${pares.length} linha(s). Nenhum arquivo foi gerado; confira o que já foi etiquetado antes de tentar de novo.`,
    )
  }

  return linhas.map((e) => ({
    ordem: Number(e.ordem),
    item: e.item,
    sequencial: Number(e.sequencial),
    codigo: e.codigo,
    locacao: e.locacao,
    pedido: e.pedido ?? '',
  }))
}

/** Progresso do mutirão: quanto do estoque antigo já foi etiquetado. */
export async function resumoLegado(): Promise<ResumoLegado> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_resumo')
  if (error) throw error

  const linha = ((data ?? []) as { total_etiquetas: number; total_itens: number; ultima: string | null }[])[0]
  return {
    totalEtiquetas: Number(linha?.total_etiquetas ?? 0),
    totalItens: Number(linha?.total_itens ?? 0),
    ultima: linha?.ultima ?? null,
  }
}

/**
 * Os rolos que ainda esperam impressão, mais novos em cima.
 *
 * ⚠️ PENDENTE É `impressa_em is null` **E** `removida_em is null`. Remover não apaga a linha (é ela
 * que guarda o sequencial, e apagá-la devolveria o número ao próximo rolo — o contrário da regra),
 * então a removida continua na tabela. Sem o segundo filtro, o que o almoxarife removeu volta para
 * a lista e entra no CSV.
 *
 * É `select` direto, sem RPC: a policy da 0126 já exige `recebimento:visualizar` para ler a tabela.
 *
 * Pede uma linha ALÉM do limite só para saber se há mais — devolve no máximo `LIMITE_LINHAS_LEGADO`
 * e avisa em `cortada`. Pedir o limite exato não distingue "tem exatamente mil" de "tem mais de
 * mil", e o aviso apareceria sem haver nada de fora.
 */
export async function listarPendentesLegado(): Promise<{ linhas: RoloEtiquetado[]; cortada: boolean }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('etiquetas_legado')
    .select(COLUNAS_ROLO)
    .is('impressa_em', null)
    .is('removida_em', null)
    .order('created_at', { ascending: false })
    .limit(LIMITE_LINHAS_LEGADO + 1)
  if (error) throw error

  const linhas = ((data ?? []) as RoloRow[]).map(paraRolo)
  return { linhas: linhas.slice(0, LIMITE_LINHAS_LEGADO), cortada: linhas.length > LIMITE_LINHAS_LEGADO }
}

/**
 * A janela que o usuário escolheu, virada em instantes.
 *
 * O `<input type="date">` do tablet manda `YYYY-MM-DD`, e `impressa_em` é timestamptz: comparar o
 * texto cru faria o dia final terminar à meia-noite e sumir com tudo o que foi impresso NELE. O
 * `-03:00` é Brasília, que é o dia que o almoxarife tem na cabeça (o servidor roda em UTC). Valor
 * que já vem com hora passa direto.
 */
function janelaImpressao(desde: string, ate: string): { de: string; ate: string } {
  const soData = /^\d{4}-\d{2}-\d{2}$/
  return {
    de: soData.test(desde) ? `${desde}T00:00:00-03:00` : desde,
    ate: soData.test(ate) ? `${ate}T23:59:59.999-03:00` : ate,
  }
}

/**
 * As etiquetas já impressas numa janela de datas, para reimprimir o que se perdeu ou se rasgou.
 * Mais novas em cima, e a removida fica fora (ela nunca foi impressa).
 */
export async function listarImpressasLegado(desde: string, ate: string): Promise<RoloEtiquetado[]> {
  const janela = janelaImpressao(desde, ate)
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('etiquetas_legado')
    .select(COLUNAS_ROLO)
    .not('impressa_em', 'is', null)
    .is('removida_em', null)
    .gte('impressa_em', janela.de)
    .lte('impressa_em', janela.ate)
    .order('impressa_em', { ascending: false })
    .limit(LIMITE_LINHAS_LEGADO)
  if (error) throw error

  return ((data ?? []) as RoloRow[]).map(paraRolo)
}

/**
 * As etiquetas já impressas com estes ids, para o "baixar de novo".
 *
 * Só as IMPRESSAS de propósito: uma pendente que saísse por aqui iria para o arquivo sem ser
 * marcada, e voltaria na próxima leva — o mesmo código colado em dois rolos.
 */
export async function listarImpressasPorIdsLegado(ids: string[]): Promise<RoloEtiquetado[]> {
  if (ids.length === 0) return []

  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('etiquetas_legado')
    .select(COLUNAS_ROLO)
    .in('id', ids)
    .not('impressa_em', 'is', null)
    .is('removida_em', null)
  if (error) throw error

  return ((data ?? []) as RoloRow[]).map(paraRolo)
}

/**
 * Tira da lista um rolo que ainda não foi impresso. O número dele NÃO volta: a linha continua na
 * tabela marcada como removida, e o próximo rolo daquele item pega o seguinte.
 */
export async function removerPendenteLegado(id: string): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('etq_legado_remover', { p_id: id })
  if (error) throw error
}

/**
 * Marca como impressas as linhas que entraram no arquivo e devolve QUANTAS de fato moveu.
 *
 * O número importa: a função só move o que está pendente, então menos do que se pediu quer dizer
 * que outra pessoa baixou o arquivo ao mesmo tempo e já levou parte da leva.
 */
export async function marcarImpressasLegado(ids: string[]): Promise<number> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('etq_legado_marcar_impressas', { p_ids: ids })
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * A linha pendente de um código recém-emitido.
 *
 * `etq_legado_emitir` devolve o código e o sequencial, mas NÃO o `id` — e é o id que a tela usa
 * para remover o rolo digitado errado. Relê a linha por `codigo`, que tem índice único (0126), para
 * o que a tela mostra ser a linha de verdade e não uma reconstrução.
 */
export async function buscarPendentePorCodigoLegado(codigo: string): Promise<RoloEtiquetado | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('etiquetas_legado')
    .select(COLUNAS_ROLO)
    .eq('codigo', codigo)
    .is('impressa_em', null)
    .is('removida_em', null)
    .limit(1)
  if (error) throw error

  const linha = ((data ?? []) as RoloRow[])[0]
  return linha ? paraRolo(linha) : null
}
