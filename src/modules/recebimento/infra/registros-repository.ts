import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { CampoDiff } from '@/modules/logs/domain/diff'
import { passagemDoEvento, type Passagem } from '../domain/etapa-processo'
import type { FiltrosRegistrosRecebimento } from '../domain/registros-filtros'
import { carregarCamposFormulario } from './processo-detalhe-repository'

/** Uma passagem de etapa, como a tela de Registros lista. */
export interface RegistroRecebimento {
  id: string
  /** Hora do evento (ISO, timestamptz do log). */
  dataHora: string
  colaborador: string
  processoId: string
  /** Número do processo: desempata o MESMO item duas vezes na mesma EMB. */
  numero: number
  emb: string
  item: string
  descricao: string
  fornecedor: string
  fabricante: string
  partNumber: string
  /** O movimento, derivado no domínio. `null` = evento que não diz nada sobre o fluxo. */
  passagem: Passagem | null
  /** O que mudou naquele momento, campo a campo (é o detalhe que abre ao clicar na linha). */
  alteracoes: CampoDiff[]
}

export interface ResultadoRegistros {
  linhas: RegistroRecebimento[]
  total: number
}

interface RegistroRpc {
  id: string
  data_hora: string
  colaborador: string
  processo_id: string
  numero: number
  emb: string
  item: string
  descricao: string
  fornecedor: string
  fabricante: string
  part_number: string
  acao: string
  secao: string | null
  etapa: string | null
  status_de: string | null
  status_para: string | null
  alteracoes: CampoDiff[] | null
  total: number
}

/** Teto de linhas por chamada: o PostgREST corta cada resposta em 1000 (`config.toml`: max_rows). */
const BLOCO_POSTGREST = 1000

/** Teto de segurança do export — evita puxar a trilha inteira sem querer. */
export const MAX_EXPORT = 20_000

function parametros(filtros: FiltrosRegistrosRecebimento, pagina: number, tamanho: number) {
  return {
    p_emb: filtros.emb ?? null,
    p_item: filtros.item ?? null,
    p_fornecedor: filtros.fornecedor ?? null,
    p_etapa: filtros.etapa ?? null,
    p_de: filtros.de ?? null,
    p_ate: filtros.ate ?? null,
    p_colaborador: filtros.colaborador ?? null,
    p_pagina: pagina,
    p_tamanho: tamanho,
  }
}

/**
 * Uma página de registros. A `rec_registros` (0124) filtra, ordena e conta no banco; aqui só
 * resolvemos o grupo de cada campo alterado (para derivar a seção salva no domínio) e traduzimos
 * para camelCase.
 */
export async function consultarRegistros(
  filtros: FiltrosRegistrosRecebimento,
  pagina: number,
  tamanho: number,
): Promise<ResultadoRegistros> {
  const supabase = await createServerSupabase()
  const [{ data, error }, campos] = await Promise.all([
    supabase.rpc('rec_registros', parametros(filtros, pagina, Math.min(tamanho, BLOCO_POSTGREST))),
    carregarCamposFormulario(),
  ])
  if (error) throw error

  // campo → grupo (`configuracao_campos`): é o grupo que diz qual seção o diff tocou.
  const grupoDoCampo = new Map(campos.map((c) => [c.campo, c.grupo as string]))
  const linhas = ((data ?? []) as RegistroRpc[]).map((l) => paraRegistro(l, grupoDoCampo))
  return { linhas, total: ((data ?? []) as RegistroRpc[])[0]?.total ?? 0 }
}

/**
 * TODAS as linhas que casam com os filtros, para exportar em planilha. Busca em blocos (o PostgREST
 * corta em 1000 por requisição) até acabar o resultado ou bater o teto.
 */
export async function listarTodosRegistros(
  filtros: FiltrosRegistrosRecebimento,
  teto = MAX_EXPORT,
): Promise<{ linhas: RegistroRecebimento[]; truncado: boolean }> {
  const linhas: RegistroRecebimento[] = []
  for (let pagina = 0; linhas.length < teto; pagina++) {
    const { linhas: lote } = await consultarRegistros(filtros, pagina, BLOCO_POSTGREST)
    linhas.push(...lote)
    if (lote.length < BLOCO_POSTGREST) return { linhas, truncado: false }
  }
  return { linhas: linhas.slice(0, teto), truncado: true }
}

function paraRegistro(l: RegistroRpc, grupoDoCampo: Map<string, string>): RegistroRecebimento {
  const alteracoes = Array.isArray(l.alteracoes) ? l.alteracoes : []
  const gruposTocados = [
    ...new Set(alteracoes.map((a) => grupoDoCampo.get(a.campo)).filter((g): g is string => !!g)),
  ]
  return {
    id: l.id,
    dataHora: l.data_hora,
    colaborador: l.colaborador,
    processoId: l.processo_id,
    numero: l.numero,
    emb: l.emb,
    item: l.item,
    descricao: l.descricao,
    fornecedor: l.fornecedor,
    fabricante: l.fabricante,
    partNumber: l.part_number,
    passagem: passagemDoEvento({
      acao: l.acao,
      // A descrição do log só é usada como desempate (diff vazio), e não sai na tela.
      descricao: l.secao ? `seção ${l.secao} salva` : '',
      gruposTocados,
      statusDe: l.status_de,
      statusPara: l.status_para,
    }),
    alteracoes,
  }
}

/**
 * Valores distintos de uma coluna do processo, para os seletores de EMB e de Fornecedor. Reusa a
 * `valores_distintos_processos` (0021), que já é a consulta do filtro do grid.
 *
 * EMB sai da mais nova para a mais antiga (é a que o pessoal procura); fornecedor, em ordem alfabética.
 */
export async function listarValoresDistintos(coluna: 'numero_emb' | 'fornecedor'): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('valores_distintos_processos', {
    p_coluna: coluna,
    p_limite: 1000,
  })
  if (error) throw error
  const valores = ((data ?? []) as { valor: string }[])
    .map((r) => (r.valor ?? '').trim())
    .filter((v) => v !== '')
  const unicos = [...new Set(valores)]
  return coluna === 'numero_emb'
    ? unicos.sort((a, b) => b.localeCompare(a, 'pt-BR', { numeric: true }))
    : unicos.sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
