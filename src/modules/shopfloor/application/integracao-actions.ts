'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { serieDentroDaFaixa, normalizarSerie, limparSerie } from '../domain/serie'
import { validarItensIntegracao, type PlacaIntegracao } from '../domain/integracao-itens'
import { carregarOrdem } from '../infra/lancamento-repository'
import {
  buscarIntegracaoPorSn,
  chamarSfIntegrar,
  chamarSfCancelarIntegracao,
  type IntegracaoDetalhe,
} from '../infra/integracao-repository'

export interface EntradaIntegracao {
  colaborador: string
  pmo: string
  op: string
  produtoSN: string
  placas: PlacaIntegracao[]
}

const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  NAO_ENCONTRADA: 'Integração ativa não encontrada para este código.',
  ERRO_INTERNO: 'Não foi possível concluir a operação.',
}

export async function integrar(
  entrada: EntradaIntegracao,
): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }

  const colaborador = entrada.colaborador.trim()
  const pmo = entrada.pmo.trim()
  const op = entrada.op.trim()
  const produtoSN = limparSerie(entrada.produtoSN)
  if (!colaborador || !pmo || !op || !produtoSN) {
    return { ok: false, erro: 'Preencha Colaborador, PMO, OP e o Nº de Série do produto final.' }
  }

  const ordem = await carregarOrdem(pmo, op)
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  if (!ordem.postos.includes('Integração')) {
    return { ok: false, erro: 'O posto Integração não se aplica a esta OP.' }
  }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  if (!serieDentroDaFaixa(ordem.sn_ini, ordem.sn_fim, produtoSN)) {
    return { ok: false, erro: 'Nº de Série do produto fora da faixa desta OP.' }
  }

  const v = validarItensIntegracao(produtoSN, entrada.placas)
  if (!v.ok) return v

  const r = await chamarSfIntegrar({
    p_colaborador: colaborador,
    p_cliente: ordem.cliente,
    p_pmo: pmo,
    p_op: op,
    p_produto_sn: produtoSN,
    p_produto_sn_norm: normalizarSerie(produtoSN),
    p_placas: v.placas.map((x) => ({
      pmo: x.pmo.trim(),
      op: x.op.trim(),
      sn: limparSerie(x.sn),
      sn_norm: normalizarSerie(x.sn),
    })),
  })

  if (!r.ok) {
    if (r.erro === 'PRODUTO_JA_INTEGRADO') {
      return { ok: false, erro: `Produto já integrado (${r.codigo ?? 'código desconhecido'}).` }
    }
    if (r.erro === 'PLACA_JA_VINCULADA') {
      return { ok: false, erro: `Placa ${r.placa ?? ''} já vinculada à integração ${r.codigo ?? ''}.` }
    }
    if (r.erro === 'PLACA_FORA_DA_RECEITA') {
      return { ok: false, erro: `A placa de PMO ${r.pmo ?? ''} não faz parte da receita deste produto.` }
    }
    return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }
  }

  await registrarLog({
    entidade: 'sf_integracao',
    entidadeId: r.codigo,
    acao: 'criar',
    descricao: `Integração ${r.codigo}: produto ${produtoSN} (${pmo}/${op}) + ${v.placas.length} placa(s)`,
    dados: { produtoSN, pmo, op, placas: v.placas },
  })
  return { ok: true, codigo: r.codigo! }
}

export async function buscarIntegracao(
  sn: string,
): Promise<{ ok: true; detalhe: IntegracaoDetalhe | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, detalhe: null }
  try {
    const detalhe = await buscarIntegracaoPorSn(alvo)
    return { ok: true, detalhe }
  } catch {
    return { ok: false, erro: MENSAGENS.ERRO_INTERNO! }
  }
}

export async function cancelarIntegracao(
  codigo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const r = await chamarSfCancelarIntegracao(codigo.trim(), sessao.nome || sessao.email)
  if (!r.ok) return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }

  await registrarLog({
    entidade: 'sf_integracao',
    entidadeId: codigo,
    acao: 'excluir',
    descricao: `Integração ${codigo} cancelada`,
  })
  return { ok: true }
}
