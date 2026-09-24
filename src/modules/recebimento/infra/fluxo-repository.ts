import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ETAPAS, type Etapa } from '../domain/etapa-processo'

/** Uma caixa do fluxo, já agregada pela `rec_fluxo_emb` (0124). */
export interface CaixaFluxo {
  etapa: Etapa
  /** Quantos itens estão na caixa agora. */
  itens: number
  /** Quantos deles carregam a marca de divergência (a marca não tira o item de lugar). */
  divergentes: number
  /** Média de há quanto tempo os itens da caixa estão nela, em segundos. `null` = ninguém com tempo. */
  mediaSegundos: number | null
  /** O item mais antigo da caixa (candidato a gargalo), em segundos. */
  maiorSegundos: number | null
  /** Itens cujo histórico não permite saber desde quando (a tela mostra "—" neles). */
  semTempo: number
}

/** Um item dentro de uma caixa, como a lista da caixa mostra. */
export interface ItemFluxo {
  processoId: string
  /** Número do processo: é ele que desempata o MESMO item duas vezes na mesma EMB. */
  numero: number
  item: string
  descricao: string
  quantidadePedido: number | null
  quantidadeRecebida: number | null
  divergencia: string
  divergente: boolean
  resultado: string
  /** Quando entrou na caixa (ISO). `null` = não deu para saber. */
  desde: string | null
  /** Há quanto tempo está na caixa, em segundos. `null` = não deu para saber. */
  segundos: number | null
}

interface CaixaRpc {
  etapa: string
  itens: number
  divergentes: number
  media_segundos: number | string | null
  maior_segundos: number | string | null
  sem_tempo: number
}

interface ItemRpc {
  processo_id: string
  numero: number
  item: string
  descricao: string
  quantidade_pedido: number | string | null
  quantidade_recebida: number | string | null
  divergencia: string
  divergente: boolean
  resultado: string
  desde: string | null
  segundos: number | string | null
}

/** `numeric` do Postgres chega como string no PostgREST (não cabe em float sem perda). */
function numero(v: number | string | null): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * As quatro caixas de uma EMB, com contagem, divergentes e tempo. A RPC sempre devolve as quatro
 * (mesmo vazias); aqui só reordenamos pela ordem do fluxo, para a tela não depender do banco.
 */
export async function carregarFluxoEmb(emb: string): Promise<CaixaFluxo[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_fluxo_emb', { p_emb: emb })
  if (error) throw error

  const porEtapa = new Map<string, CaixaRpc>()
  for (const linha of (data ?? []) as CaixaRpc[]) porEtapa.set(linha.etapa, linha)

  return ETAPAS.map((etapa) => {
    const l = porEtapa.get(etapa)
    return {
      etapa,
      itens: l?.itens ?? 0,
      divergentes: l?.divergentes ?? 0,
      mediaSegundos: numero(l?.media_segundos ?? null),
      maiorSegundos: numero(l?.maior_segundos ?? null),
      semTempo: l?.sem_tempo ?? 0,
    }
  })
}

/** Teto de itens por caixa. O PostgREST corta a resposta em 1000 linhas; a tela compara com a
 *  contagem do resumo e avisa quando está mostrando só uma parte. */
export const TETO_ITENS_CAIXA = 500

/** Os itens de uma caixa, mais antigo primeiro (é o que interessa em "travada em quê"). */
export async function carregarItensCaixa(emb: string, etapa: Etapa): Promise<ItemFluxo[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_fluxo_emb_itens', {
    p_emb: emb,
    p_etapa: etapa,
    p_limite: TETO_ITENS_CAIXA,
  })
  if (error) throw error
  return ((data ?? []) as ItemRpc[]).map((l) => ({
    processoId: l.processo_id,
    numero: l.numero,
    item: l.item,
    descricao: l.descricao,
    quantidadePedido: numero(l.quantidade_pedido),
    quantidadeRecebida: numero(l.quantidade_recebida),
    divergencia: l.divergencia,
    divergente: l.divergente,
    resultado: l.resultado,
    desde: l.desde,
    segundos: numero(l.segundos),
  }))
}
