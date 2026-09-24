import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ETAPAS, passagemDoEvento, type Etapa, type Passagem } from '../domain/etapa-processo'

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
  /** Valor cru do campo calculado. Quem decide se é divergência é `temDivergencia` (domínio). */
  divergencia: string
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
    resultado: l.resultado,
    desde: l.desde,
    segundos: numero(l.segundos),
  }))
}

/** Uma linha do histórico da etapa: quem passou por ela e quando. */
export interface PassagemEtapa {
  id: string
  /** Hora do evento (ISO). */
  dataHora: string
  colaborador: string
  processoId: string
  numero: number
  item: string
  descricao: string
  /** O movimento, derivado no domínio. `null` = evento que não diz nada sobre o fluxo. */
  passagem: Passagem | null
}

interface HistoricoRpc {
  id: string
  data_hora: string
  colaborador: string
  processo_id: string
  numero: number
  item: string
  descricao: string
  acao: string
  secao: string | null
  etapa: string | null
  etapa_origem: string | null
  status_de: string | null
  status_para: string | null
  total: number
}

/** Quantas linhas o histórico busca por vez (a mesma página do histórico do posto do ShopFloor). */
export const PAGINA_HISTORICO = 100

/**
 * Histórico de uma etapa da EMB: os eventos que ENVOLVEM aquela caixa (chegou nela, trabalhou nela
 * ou saiu dela), mais recente primeiro. Paginado — o painel busca +100 conforme rola.
 */
export async function carregarHistoricoEtapa(
  emb: string,
  etapa: Etapa,
  offset: number,
): Promise<{ linhas: PassagemEtapa[]; total: number }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('rec_fluxo_emb_historico', {
    p_emb: emb,
    p_etapa: etapa,
    p_offset: offset,
    p_limite: PAGINA_HISTORICO,
  })
  if (error) throw error
  const linhas = (data ?? []) as HistoricoRpc[]
  return {
    linhas: linhas.map((l) => ({
      id: l.id,
      dataHora: l.data_hora,
      colaborador: l.colaborador,
      processoId: l.processo_id,
      numero: l.numero,
      item: l.item,
      descricao: l.descricao,
      // A seção já vem resolvida do banco (diff + desempate pela descrição); o rótulo do movimento
      // sai do domínio, o mesmo que a tela de Registros usa.
      passagem: passagemDoEvento({
        acao: l.acao,
        descricao: l.secao ? `seção ${l.secao} salva` : '',
        gruposTocados: [],
        statusDe: l.status_de,
        statusPara: l.status_para,
      }),
    })),
    total: linhas[0]?.total ?? 0,
  }
}
