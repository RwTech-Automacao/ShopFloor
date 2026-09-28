'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { classificarBipeAlmoxarifado, type RecusaBipeAlmoxarifado } from '../domain/almoxarifado'
import { normalizarSerie } from '../domain/serie'
import { carregarOrdem } from '../infra/lancamento-repository'

export interface EntradaAlmoxarifado {
  pmo: string
  op: string
  posto: string
  colaborador: string
  bipe: string
}

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

/**
 * Recusa de FORMATO (classificarBipeAlmoxarifado): decidida só pelo que foi bipado, sem round-trip
 * ao banco. `vazio` também cai aqui — sem texto nenhum não há o que classificar.
 */
const RECUSAS_FORMATO: Record<RecusaBipeAlmoxarifado, string> = {
  vazio: 'Bipe o Nº de Série da peça ou o código da caixa.',
  caixa_aberta: 'Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada.',
  caixa_em_op_individual: 'Nesta OP a entrada é por peça. Bipe o Nº de Série.',
  serie_em_op_coletiva: 'Nesta OP a entrada é por caixa. Bipe o código da caixa.',
}

/**
 * Recusa de DADO, vinda da RPC `sf_almoxarifado_entrada`. Cada motivo vira uma frase que diz o que
 * aconteceu e o que fazer — nunca só "erro".
 *
 * `caixa_nao_encontrada` cobre DUAS situações reais: etiqueta de outra OP/código digitado errado, e
 * caixa REABERTA na Embalagem — a 0106 limpa o campo `codigo` ao reabrir, então o bipe de uma caixa
 * reaberta cai aqui também, não em `caixa_aberta`. A frase precisa dar conta das duas.
 *
 * `sem_permissao` volta SEM `detalhe` — por isso não depende dele. Os demais usam o `detalhe` da
 * RPC quando ele já é a frase pronta (data/hora/quem, faixa, etc.); quando não, um texto fixo.
 */
function mensagemRecusaBanco(motivo: string, detalhe?: string): string {
  switch (motivo) {
    case 'sem_permissao':
      return SEM_PERMISSAO
    case 'ordem_nao_encontrada':
      return detalhe || 'Ordem não encontrada.'
    case 'posto_invalido':
      return detalhe || 'Este posto não é um posto de Almoxarifado.'
    case 'caixa_nao_encontrada':
      return 'Caixa não encontrada nesta OP. Se ela foi reaberta na Embalagem, feche-a de novo antes de dar entrada.'
    case 'caixa_aberta':
      return 'Esta caixa ainda não foi fechada. Feche a caixa na Embalagem antes de dar entrada.'
    case 'caixa_reprovada':
      return detalhe || 'Esta caixa foi reprovada no NQA e vai ser remontada.'
    case 'ja_lancado':
      return detalhe || 'Este bipe já deu entrada antes.'
    case 'serie_fora_da_faixa':
      return detalhe || 'Esta série está fora da faixa desta OP.'
    case 'serie_sem_embalagem':
      return 'Esta peça ainda não passou pela Embalagem.'
    default:
      return 'Não foi possível registrar a entrada.'
  }
}

/**
 * Entrada no Almoxarifado: bipa o que acabou de ser embalado. `classificarBipeAlmoxarifado`
 * decide pelo FORMATO se peça ou caixa (sem tocar o banco); o que depende de dado — caixa existe,
 * está fechada, já foi lançada, a peça passou pela Embalagem — é a RPC `sf_almoxarifado_entrada`
 * quem confere, numa transação só (corrida entre dois operadores incluída).
 */
export async function registrarEntradaAlmoxarifado(
  entrada: EntradaAlmoxarifado,
): Promise<{ ok: true; quantidade: number; tipo: 'serie' | 'caixa' } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { ok: false, erro: SEM_PERMISSAO }
  }

  // 'vazio' não depende de OP nenhuma — resolvido sem round-trip ao banco.
  const bipeBruto = entrada.bipe ?? ''
  if (bipeBruto.trim() === '') {
    return { ok: false, erro: RECUSAS_FORMATO.vazio }
  }

  const pmo = entrada.pmo.trim()
  const op = entrada.op.trim()
  const posto = entrada.posto.trim()
  const colaborador = entrada.colaborador.trim()
  if (!colaborador || !pmo || !op || !posto) {
    return { ok: false, erro: 'Preencha Colaborador, contexto (OP) e Posto antes de bipar.' }
  }

  // A OP diz se a embalagem é individual ou coletiva — é o que classificarBipeAlmoxarifado precisa
  // pra saber se o formato bipado (série × código de caixa) é o esperado nesta OP.
  const ordem = await carregarOrdem(pmo, op)
  if (!ordem) return { ok: false, erro: 'Ordem não encontrada.' }

  const classificado = classificarBipeAlmoxarifado(bipeBruto, ordem.embalagem_individual)
  if (!classificado.ok) {
    return { ok: false, erro: RECUSAS_FORMATO[classificado.recusa] }
  }

  const { tipo, serie, codigoCaixa, quantidade } = classificado.bipe
  // p_serie_norm vem PRONTO do aplicativo (vazio na caixa) — é a mesma normalização que a
  // Embalagem grava em numero_serie_norm; sem isso a checagem de duplicidade da RPC não casa.
  const bipeParaRpc = tipo === 'caixa' ? codigoCaixa : serie
  const serieNorm = tipo === 'serie' ? normalizarSerie(serie) : ''

  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_almoxarifado_entrada', {
    p_pmo: pmo,
    p_op: op,
    p_posto: posto,
    p_colaborador: colaborador,
    p_bipe: bipeParaRpc,
    p_tipo: tipo,
    p_quantidade: quantidade,
    p_serie_norm: serieNorm,
  })
  if (error) return { ok: false, erro: 'Não foi possível registrar a entrada.' }

  const r = data as { ok: boolean; motivo?: string; detalhe?: string; quantidade?: number }
  if (!r.ok) return { ok: false, erro: mensagemRecusaBanco(r.motivo ?? '', r.detalhe) }
  return { ok: true, quantidade: r.quantidade ?? quantidade, tipo }
}
