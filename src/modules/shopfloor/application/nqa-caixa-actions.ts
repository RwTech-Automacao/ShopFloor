'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { resolverCaixaPorSn } from '@/modules/shopfloor/infra/caixa-repository'
// Tabela NQA é referência compartilhada (cadastrada em Config → Tabela NQA); reusa o leitor do Recebimento.
import { carregarTabelaNqa } from '@/modules/recebimento/infra/referencias-repository'
import { buscarNqa } from '@/modules/recebimento/domain/calculos'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export interface CaixaNqa {
  numeroCaixa: string
  postoEmbalagem: string
  qtd: number
  amostra: number
  jaInspecionada: boolean
}

/** Bipe de "puxar caixa": resolve a caixa do SN + calcula a amostra pela Tabela NQA (qtd da caixa). */
export async function carregarNqaCaixa(
  pmo: string,
  op: string,
  posto: string,
  sn: string,
): Promise<{ ok: true; caixa: CaixaNqa } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const caixa = await resolverCaixaPorSn(pmo.trim(), op.trim(), sn, posto.trim())
    if (!caixa) return { ok: false, erro: 'SN não está em nenhuma caixa. Embale/feche a caixa primeiro.' }
    if (!caixa.fechada) return { ok: false, erro: 'A caixa desta peça ainda não foi fechada. Feche a caixa na Embalagem antes do NQA.' }
    const amostra = buscarNqa(caixa.qtd, await carregarTabelaNqa())
    if (amostra === null) {
      return { ok: false, erro: `Sem tamanho de amostra na Tabela NQA para ${caixa.qtd} peça(s). Configure em Config → Tabela NQA.` }
    }
    return {
      ok: true,
      caixa: {
        numeroCaixa: caixa.numeroCaixa,
        postoEmbalagem: caixa.posto,
        qtd: caixa.qtd,
        amostra,
        jaInspecionada: caixa.jaInspecionadaNqa,
      },
    }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar a caixa.' }
  }
}

export interface AmostraNqa {
  snNorm: string
  visual: string
  funcional: string
  observacao: string
}

/**
 * Finaliza a caixa no NQA: `Aprovado` (libera todas as peças) ou `Reprovado` (todas voltam ao
 * `postoRetorno` escolhido). Grava 1 registro por SN da caixa via RPC `sf_nqa_caixa` (atômico).
 */
export async function finalizarNqaCaixa(entrada: {
  colaborador: string
  pmo: string
  op: string
  posto: string
  numeroCaixa: string
  resultado: 'Aprovado' | 'Reprovado'
  postoRetorno?: string
  amostras: AmostraNqa[]
}): Promise<{ ok: true; total: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  if (entrada.resultado === 'Reprovado' && !entrada.postoRetorno?.trim()) {
    return { ok: false, erro: 'Escolha o posto de retorno da caixa reprovada.' }
  }
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase.rpc('sf_nqa_caixa', {
      p_pmo: entrada.pmo.trim(),
      p_op: entrada.op.trim(),
      p_posto: entrada.posto.trim(),
      p_colaborador: entrada.colaborador,
      p_numero_caixa: entrada.numeroCaixa,
      p_resultado: entrada.resultado,
      p_posto_retorno: entrada.postoRetorno?.trim() ?? '',
      p_amostras: entrada.amostras.map((a) => ({
        sn_norm: a.snNorm,
        visual: a.visual,
        funcional: a.funcional,
        observacao: a.observacao,
      })),
    })
    if (error) {
      const msg = error.message || ''
      if (msg.includes('CAIXA_JA_INSPECIONADA')) return { ok: false, erro: 'Esta caixa já foi inspecionada no NQA.' }
      if (msg.includes('CAIXA_VAZIA')) return { ok: false, erro: 'Caixa sem peças.' }
      return { ok: false, erro: 'Não foi possível registrar o NQA da caixa.' }
    }
    const r = data as unknown as { ok: boolean; total: number }
    return { ok: true, total: r.total }
  } catch {
    return { ok: false, erro: 'Falha ao registrar o NQA da caixa.' }
  }
}
