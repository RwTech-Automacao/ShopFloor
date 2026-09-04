'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { mapaPostoPerfil } from '@/modules/shopfloor/infra/postos-repository'
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

export interface IrmasLoteReprovado {
  elegiveis: string[]  // SNs do mesmo lote reprovado, já de volta do retrabalho — prontas pra reentrar
  pendentes: string[]  // SNs do mesmo lote, ainda não saíram do NQA (retrabalho não iniciado)
}

/**
 * Valida UMA peça no momento do bipe, antes de entrar no lote. Confere, nesta ordem:
 *  1. pertence a esta OP;
 *  2. JÁ FOI EMBALADA (tem registro num posto de perfil `caixa`) — o NQA inspeciona produto
 *     embalado; sem esta checagem entrava no lote peça que nem chegou na embalagem ainda;
 *  3. não está no NQA agora (já inspecionada / aguardando reteste).
 * Na peça ÂNCORA (1ª do lote) devolve também as peças-irmãs de um lote reprovado anterior.
 */
export async function validarBipeLoteIndividual(
  pmo: string,
  op: string,
  posto: string,
  sn: string,
  ancora: boolean,
): Promise<{ ok: true; snNorm: string; irmas: IrmasLoteReprovado } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  const snNorm = normalizarSerie(sn)
  if (!snNorm) return { ok: false, erro: 'Nº de Série inválido.' }

  const vazio: IrmasLoteReprovado = { elegiveis: [], pendentes: [] }
  try {
    const supabase = await createServerSupabase()
    const { data, error } = await supabase
      .from('sf_registros')
      .select('posto,data_hora,created_at')
      .eq('pmo', pmo.trim())
      .eq('op', op.trim())
      .eq('numero_serie_norm', snNorm)
      .order('data_hora', { ascending: false })
      .order('created_at', { ascending: false })
    if (error) throw error
    const linhas = (data ?? []) as { posto: string }[]
    if (linhas.length === 0) return { ok: false, erro: 'Este Nº de Série não pertence a esta OP.' }

    // Embalada? Precisa ter passado por algum posto de perfil `caixa` (embalagem).
    const perfis = await mapaPostoPerfil()
    const passouNaEmbalagem = linhas.some((l) => perfis[l.posto]?.recurso === 'caixa')
    if (!passouNaEmbalagem) {
      return { ok: false, erro: 'Esta peça ainda não foi embalada — embale antes de inspecionar no NQA.' }
    }

    // A query veio ordenada desc: a primeira linha é o último registro da peça.
    if (linhas[0]!.posto === posto.trim()) {
      return { ok: false, erro: 'Esta peça já está no NQA — aguardando reteste ou já finalizada.' }
    }

    if (!ancora) return { ok: true, snNorm, irmas: vazio }
    const r = await buscarIrmasLoteReprovado(pmo, op, posto, sn)
    return { ok: true, snNorm, irmas: r.ok ? r.irmas : vazio }
  } catch {
    return { ok: false, erro: 'Não foi possível validar esta peça.' }
  }
}

/**
 * Ao bipar a PRIMEIRA peça de um lote novo, verifica se ela é "irmã" de um lote reprovado
 * anteriormente (mesma `nqa_lote_id`) — e se as demais já voltaram do retrabalho. Sem caixa física
 * ligando as peças, é assim que o painel reconhece o grupo sozinho, igual à caixa reconhece pelo
 * `numero_caixa`. Retorna listas vazias se esta peça nunca fez parte de um lote reprovado.
 */
export async function buscarIrmasLoteReprovado(
  pmo: string,
  op: string,
  posto: string,
  sn: string,
): Promise<{ ok: true; irmas: IrmasLoteReprovado } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  const snNorm = normalizarSerie(sn)
  if (!snNorm) return { ok: true, irmas: { elegiveis: [], pendentes: [] } }

  try {
    const supabase = await createServerSupabase()
    const postoTrim = posto.trim()

    // Último lote REPROVADO desta peça neste posto (se houver) — define o grupo a reconstruir.
    const { data: reprovacoes, error: e1 } = await supabase
      .from('sf_registros')
      .select('nqa_lote_id,data_hora,created_at')
      .eq('pmo', pmo.trim()).eq('op', op.trim()).eq('posto', postoTrim)
      .eq('numero_serie_norm', snNorm)
      .ilike('status', 'reprovado')
      .not('nqa_lote_id', 'is', null)
      .order('data_hora', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
    if (e1) throw e1
    const loteId = (reprovacoes?.[0] as { nqa_lote_id: string } | undefined)?.nqa_lote_id
    if (!loteId) return { ok: true, irmas: { elegiveis: [], pendentes: [] } }

    // Demais SNs do mesmo lote (exclui a própria peça bipada).
    const { data: irmasData, error: e2 } = await supabase
      .from('sf_registros')
      .select('numero_serie_norm')
      .eq('pmo', pmo.trim()).eq('op', op.trim()).eq('posto', postoTrim)
      .eq('nqa_lote_id', loteId)
      .neq('numero_serie_norm', snNorm)
    if (e2) throw e2
    const candidatos = [...new Set((irmasData ?? []).map((r) => (r as { numero_serie_norm: string }).numero_serie_norm))]
    if (candidatos.length === 0) return { ok: true, irmas: { elegiveis: [], pendentes: [] } }

    // Último registro (qualquer posto) de cada irmã — só está pronta se já SAIU do NQA.
    const { data: hist, error: e3 } = await supabase
      .from('sf_registros')
      .select('numero_serie_norm,posto,data_hora,created_at')
      .eq('pmo', pmo.trim()).eq('op', op.trim())
      .in('numero_serie_norm', candidatos)
      .order('data_hora', { ascending: false })
      .order('created_at', { ascending: false })
    if (e3) throw e3
    const ultimoPosto = new Map<string, string>()
    for (const l of (hist ?? []) as { numero_serie_norm: string; posto: string }[]) {
      if (!ultimoPosto.has(l.numero_serie_norm)) ultimoPosto.set(l.numero_serie_norm, l.posto)
    }

    const elegiveis = candidatos.filter((s) => ultimoPosto.get(s) !== postoTrim)
    const pendentes = candidatos.filter((s) => ultimoPosto.get(s) === postoTrim)
    return { ok: true, irmas: { elegiveis, pendentes } }
  } catch {
    return { ok: false, erro: 'Não foi possível verificar peças-irmãs de lote reprovado.' }
  }
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

    // Backstop do "já foi embalada" — o bipe já barra peça não embalada, mas o lote também pode
    // chegar aqui vindo do localStorage. O NQA inspeciona produto embalado, então nenhuma peça
    // sem passagem por posto de perfil `caixa` pode entrar no lote.
    const perfis = await mapaPostoPerfil()
    const embaladas = new Set(
      linhas.filter((l) => perfis[l.posto]?.recurso === 'caixa').map((l) => l.numero_serie_norm),
    )
    const naoEmbaladas = snsNorm.filter((s) => !embaladas.has(s))
    if (naoEmbaladas.length > 0) {
      return {
        ok: false,
        erro: `Ainda não foi embalada: ${naoEmbaladas.slice(0, 3).join(', ')}${naoEmbaladas.length > 3 ? '…' : ''}`,
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
