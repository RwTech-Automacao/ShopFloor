'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
// Tabela NQA é referência compartilhada (cadastrada em Config → Tabela NQA); reusa o leitor do Recebimento.
import { carregarTabelaNqa } from '@/modules/recebimento/infra/referencias-repository'
import { buscarNqa } from '@/modules/recebimento/domain/calculos'
import type { AmostraNqa } from './nqa-caixa-actions'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export interface LoteNqaIndividual {
  qtd: number
  amostra: number
  snsNorm: string[]
}

/**
 * Fecha o lote que o NQA definiu bipando peça a peça — embalagem individual não tem caixa física
 * pra agrupar (cada peça é seu próprio "pacote"). Valida que TODOS os SNs pertencem a esta OP e
 * nenhum já foi inspecionado no NQA, depois calcula o tamanho da amostra pela Tabela NQA (mesma
 * tabela do NQA por caixa) com base na QUANTIDADE de peças que o NQA bipou pro lote.
 */
export async function carregarLoteNqaIndividual(
  pmo: string,
  op: string,
  posto: string,
  sns: string[],
): Promise<{ ok: true; lote: LoteNqaIndividual } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }

  const snsNorm = [...new Set(sns.map(normalizarSerie).filter(Boolean))]
  if (snsNorm.length === 0) return { ok: false, erro: 'Bipe ao menos um Nº de Série para formar o lote.' }

  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie_norm,posto,data_hora,created_at')
      .eq('pmo', pmo.trim())
      .eq('op', op.trim())
      .in('numero_serie_norm', snsNorm)
      .order('data_hora', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    const linhas = (data ?? []) as { numero_serie_norm: string; posto: string }[]

    const encontrados = new Set(linhas.map((l) => l.numero_serie_norm))
    const faltando = snsNorm.filter((s) => !encontrados.has(s))
    if (faltando.length > 0) {
      return {
        ok: false,
        erro: `Não pertence a esta OP: ${faltando.slice(0, 3).join(', ')}${faltando.length > 3 ? '…' : ''}`,
      }
    }

    // A query já veio ordenada desc (data_hora, created_at) — o primeiro que aparece por SN é o último registro.
    const ultimoPosto = new Map<string, string>()
    for (const l of linhas) if (!ultimoPosto.has(l.numero_serie_norm)) ultimoPosto.set(l.numero_serie_norm, l.posto)
    const postoTrim = posto.trim()
    const jaInspecionados = snsNorm.filter((s) => ultimoPosto.get(s) === postoTrim)
    if (jaInspecionados.length > 0) {
      return {
        ok: false,
        erro: `Já inspecionado no NQA: ${jaInspecionados.slice(0, 3).join(', ')}${jaInspecionados.length > 3 ? '…' : ''}`,
      }
    }

    const amostra = buscarNqa(snsNorm.length, await carregarTabelaNqa())
    if (amostra === null || amostra <= 0) {
      return {
        ok: false,
        erro: `Tamanho de amostra inválido na Tabela NQA para ${snsNorm.length} peça(s). Configure em Config → Tabela NQA.`,
      }
    }
    return { ok: true, lote: { qtd: snsNorm.length, amostra, snsNorm } }
  } catch {
    return { ok: false, erro: 'Não foi possível validar o lote.' }
  }
}

/**
 * Finaliza o lote no NQA: `Aprovado` (libera todas as peças do lote) ou `Reprovado` (todas voltam
 * ao(s) `postoRetorno` escolhido(s)). Grava 1 registro por SN do lote via RPC `sf_nqa_individual`
 * (atômico) — mesma semântica do NQA por caixa, só que a membresia do lote é o array de SNs que o
 * NQA definiu na hora, não um agrupamento físico em `sf_caixas`.
 */
export async function finalizarNqaIndividual(entrada: {
  colaborador: string
  pmo: string
  op: string
  posto: string
  snsNorm: string[]
  resultado: 'Aprovado' | 'Reprovado'
  postosRetorno?: string[] // postos a repassar, EM ORDEM DA OP (só na reprova)
  amostras: AmostraNqa[]
}): Promise<{ ok: true; total: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  if (entrada.resultado === 'Reprovado' && (entrada.postosRetorno ?? []).length === 0) {
    return { ok: false, erro: 'Escolha ao menos um posto que o lote deve repassar.' }
  }
  const postoRetorno =
    entrada.resultado === 'Reprovado'
      ? [...(entrada.postosRetorno ?? []), entrada.posto.trim()].join(',')
      : ''
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('sf_nqa_individual', {
      p_pmo: entrada.pmo.trim(),
      p_op: entrada.op.trim(),
      p_posto: entrada.posto.trim(),
      p_colaborador: entrada.colaborador,
      p_sns_norm: entrada.snsNorm,
      p_resultado: entrada.resultado,
      p_posto_retorno: postoRetorno,
      p_amostras: entrada.amostras.map((a) => ({
        sn_norm: a.snNorm,
        visual: a.visual,
        funcional: a.funcional,
        observacao: a.observacao,
      })),
    })
    if (error) {
      const msg = error.message || ''
      if (msg.includes('LOTE_VAZIO')) return { ok: false, erro: 'Lote sem peças.' }
      if (msg.includes('LOTE_SN_DUPLICADO')) return { ok: false, erro: 'Há Nº de Série repetido no lote.' }
      if (msg.includes('SN_FORA_DA_OP')) return { ok: false, erro: 'Há Nº de Série que não pertence a esta OP.' }
      if (msg.includes('LOTE_JA_INSPECIONADO')) return { ok: false, erro: 'Uma ou mais peças do lote já foram inspecionadas no NQA.' }
      if (msg.includes('AMOSTRA_FORA_DO_LOTE')) return { ok: false, erro: 'Há amostra que não pertence a este lote. Recarregue e inspecione de novo.' }
      if (msg.includes('AMOSTRAS_INSUFICIENTES')) return { ok: false, erro: 'Quantidade de amostras menor que a exigida pela Tabela NQA.' }
      if (msg.includes('APROVADO_COM_REPROVA')) return { ok: false, erro: 'Não é possível aprovar: há amostra reprovada.' }
      if (msg.includes('AMOSTRA_NQA_INVALIDA')) return { ok: false, erro: 'Tamanho de amostra inválido na Tabela NQA para este lote.' }
      if (msg.includes('REPROVADO_SEM_REPROVA')) return { ok: false, erro: 'Para reprovar o lote, ao menos uma amostra precisa estar reprovada.' }
      return { ok: false, erro: 'Não foi possível registrar o NQA do lote.' }
    }
    const r = data as unknown as { ok: boolean; total: number }
    return { ok: true, total: r.total }
  } catch {
    return { ok: false, erro: 'Falha ao registrar o NQA do lote.' }
  }
}
