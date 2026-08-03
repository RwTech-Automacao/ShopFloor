'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { serieDentroDaFaixa, normalizarSerie, limparSerie } from '../domain/serie'
import { validarItensIntegracao, type PlacaIntegracao } from '../domain/integracao-itens'
import { postoAnteriorNaSequencia } from '../domain/postos'
import { perfilPrecisaAprovado, PERFIL_PADRAO } from '../domain/perfil-posto'
import { resolverPlaca } from '../domain/integracao-matching'
import { carregarOrdem, listarFaixasOrdens, listarOrdensParaLancamento } from '../infra/lancamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  buscarIntegracoesPorSn,
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
  posto: string
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
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
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
  const posto = entrada.posto.trim()
  const mapa = await mapaPostoPerfil()
  if (!posto || !ordem.postos.includes(posto) || mapa[posto]?.recurso !== 'integracao') {
    return { ok: false, erro: 'Posto de Integração inválido para esta OP.' }
  }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  if (!serieDentroDaFaixa(ordem.sn_ini, ordem.sn_fim, produtoSN)) {
    return { ok: false, erro: 'Nº de Série do produto fora da faixa desta OP.' }
  }

  const v = validarItensIntegracao(produtoSN, entrada.placas)
  if (!v.ok) return v

  // N1: cada placa com faixa cadastrada na sua OP precisa ter o SN dentro dela (gradual: sem faixa → passa).
  const faixas = await listarFaixasOrdens()
  const mapaFaixa = new Map(faixas.map((f) => [`${f.pmo.trim()}||${f.op.trim()}`, f]))
  for (let i = 0; i < v.placas.length; i++) {
    const placa = v.placas[i]!
    const f = mapaFaixa.get(`${placa.pmo.trim()}||${placa.op.trim()}`)
    if (f && f.sn_ini.trim() !== '' && f.sn_fim.trim() !== '' && !serieDentroDaFaixa(f.sn_ini, f.sn_fim, placa.sn)) {
      return { ok: false, erro: `Nº de Série da placa ${i + 1} fora da faixa da OP ${placa.op}.` }
    }
  }

  // Integração é um posto: exige o anterior do fluxo satisfeito p/ o produto (trava de sequência).
  const prevPosto = postoAnteriorNaSequencia(posto, ordem.postos)

  const r = await chamarSfIntegrar({
    p_colaborador: colaborador,
    p_cliente: ordem.cliente,
    p_pmo: pmo,
    p_op: op,
    p_produto_sn: produtoSN,
    p_produto_sn_norm: normalizarSerie(produtoSN),
    p_prev_posto: prevPosto ?? '',
    p_prev_precisa_aprovado: prevPosto ? perfilPrecisaAprovado(mapa[prevPosto] ?? PERFIL_PADRAO) : false,
    p_placas: v.placas.map((x) => ({
      pmo: x.pmo.trim(),
      op: x.op.trim(),
      sn: limparSerie(x.sn),
      sn_norm: normalizarSerie(x.sn),
    })),
    p_posto: posto,
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
    if (r.erro === 'SEQUENCIA') {
      return { ok: false, erro: `Não é possível integrar: o produto ainda não passou por ${r.posto ?? 'um posto anterior do fluxo'}.` }
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

/** Resolve o SN de uma placa bipada para a OP/PMO da receita do produto (Integração por bipe). */
export async function resolverPlacaIntegracaoAction(
  pmoProduto: string,
  opProduto: string,
  posto: string,
  sn: string,
): Promise<
  | { ok: true; pmo: string; op: string }
  | { ok: false; erro: string }
  | { ok: false; erro: 'AMBIGUO'; candidatos: { pmo: string; op: string }[] }
> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const pmo = pmoProduto.trim()
  const op = opProduto.trim()
  const ordens = await listarOrdensParaLancamento()
  const ordem = ordens.find((o) => o.pmo === pmo && o.op === op)
  if (!ordem) return { ok: false, erro: 'OP do produto não encontrada.' }
  const receita = ordem.receitaPorPosto?.[posto.trim()] ?? []
  const faixas = await listarFaixasOrdens()
  // Devolve a PMO na caixa da RECEITA (é por ela que o painel indexa as linhas); a faixa
  // (sf_ordens.pmo) pode ter caixa diferente, pois PMO é campo livre.
  const paraReceita = (p: string) => receita.find((c) => c.trim().toLowerCase() === p.trim().toLowerCase()) ?? p
  // Aviso já no bipe: se a placa já está em outra integração ATIVA, barra aqui
  // (não deixa montar tudo e só reclamar no Registrar).
  const vinc = await buscarIntegracoesPorSn(normalizarSerie(sn))
  if (vinc.length > 0) {
    return { ok: false, erro: `Placa já vinculada à integração ${vinc[0]!.codigo}.` }
  }
  const r = resolverPlaca(receita, faixas, limparSerie(sn))
  if (r.ok) return { ok: true, pmo: paraReceita(r.pmo), op: r.op }
  if (r.erro === 'AMBIGUO') {
    // Ambíguo: devolve os candidatos (PMO na caixa da receita) pro operador escolher.
    return { ok: false, erro: 'AMBIGUO', candidatos: r.candidatos.map((c) => ({ pmo: paraReceita(c.pmo), op: c.op })) }
  }
  return {
    ok: false,
    erro: r.erro === 'FORA_RECEITA' ? 'Essa placa não faz parte da receita deste produto.' : 'SN não encontrado em nenhuma OP.',
  }
}

export async function buscarIntegracao(
  sn: string,
): Promise<{ ok: true; detalhes: IntegracaoDetalhe[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, detalhes: [] }
  try {
    const detalhes = await buscarIntegracoesPorSn(alvo)
    return { ok: true, detalhes }
  } catch {
    return { ok: false, erro: MENSAGENS.ERRO_INTERNO! }
  }
}

export async function cancelarIntegracao(
  codigo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
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
