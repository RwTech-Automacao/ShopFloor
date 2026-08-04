'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { serieDentroDaFaixa, normalizarSerie, limparSerie } from '../domain/serie'
import { postoAnteriorNaSequencia } from '../domain/postos'
import {
  PERFIL_PADRAO,
  perfilTemStatus,
  perfilPrecisaAprovado,
  perfilExigeManutencao,
  perfilPedeConfirmacaoConserto,
  montarLinhasPerfil,
  obrigatoriosPorPerfil,
} from '../domain/perfil-posto'
import {
  carregarOrdem, chamarSfLancar, chamarSfBurnin, buscarEntradaBurninAberta,
  buscarUltimaReprovaDoPosto, inserirConservoConfirmado, type DefeitoConfirmavel,
} from '../infra/lancamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'

export interface EntradaLancamento {
  colaborador: string
  posto: string
  pmo: string
  op: string
  numeroSerie: string
  status?: string
  numeroCaixa?: string
  qtdPorCaixa?: string
  nqaVisual?: string
  nqaFuncional?: string
  defeitos?: { codigo: string; posicao: string; tipo: string }[]
  posicoesSPI?: string[]
  burninEvento?: 'entrada' | 'saida'
  /** Defeitos que o operador confirmou terem sido consertados (auditoria ao aprovar). */
  conservoConfirmado?: DefeitoConfirmavel[]
}

export type ResultadoLancamento = { ok: true; caixaCount?: number } | { ok: false; erro: string }

const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para lançar.',
  DUPLICADO: 'Esta peça já foi registrada neste posto.',
  DUPLICADO_APROVADO: 'Esta peça já foi aprovada neste posto e não pode ser lançada de novo.',
  SEQUENCIA: 'O posto anterior ainda não foi concluído para esta peça.',
  CAIXA_CHEIA: 'A caixa já atingiu o limite de peças.',
  SEM_MANUTENCAO: 'A peça reprovou e precisa passar pela Manutenção antes de ser lançada de novo.',
  JA_DENTRO: 'Esta peça já está no Burn-in (entrada aberta).',
  JA_APROVADO: 'Esta peça já concluiu o Burn-in aprovada.',
  SEM_ENTRADA: 'Não há entrada de Burn-in aberta para esta peça — registre a entrada primeiro.',
  ERRO_INTERNO: 'Não foi possível registrar o lançamento.',
}

export async function lancar(entrada: EntradaLancamento): Promise<ResultadoLancamento> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }

  const mapa = await mapaPostoPerfil()
  const perfil = mapa[entrada.posto] ?? PERFIL_PADRAO

  // Integração não é lançável aqui: exige o vínculo produto↔placas da tela de Integração.
  if (perfil.recurso === 'integracao') {
    return { ok: false, erro: 'O posto Integração é registrado na tela de Integração.' }
  }

  // Burn-in tem lifecycle próprio (entrada/saída) — obrigatórios à parte.
  const ehBurnin = perfil.recurso === 'burnin'
  if (ehBurnin) {
    if (
      entrada.colaborador.trim() === '' || entrada.pmo.trim() === '' ||
      entrada.op.trim() === '' || entrada.numeroSerie.trim() === ''
    ) {
      return { ok: false, erro: 'Preencha Colaborador, PMO, OP e o Nº de Série.' }
    }
    if (entrada.burninEvento === 'saida') {
      const reprov = (entrada.status ?? '').toLowerCase() === 'reprovado'
      if (reprov && !(entrada.defeitos?.[0]?.codigo && entrada.defeitos[0].posicao && entrada.defeitos[0].tipo)) {
        return { ok: false, erro: 'Reprovado exige código, posição e tipo do defeito.' }
      }
    }
  } else {
    // Obrigatórios por perfil (domínio puro).
    const val = obrigatoriosPorPerfil(perfil, {
      colaborador: entrada.colaborador,
      pmo: entrada.pmo,
      op: entrada.op,
      numeroSerie: entrada.numeroSerie,
      status: entrada.status,
      numeroCaixa: entrada.numeroCaixa,
      limiteCaixa: entrada.qtdPorCaixa,
      nqaVisual: entrada.nqaVisual,
      nqaFuncional: entrada.nqaFuncional,
      cod: entrada.defeitos?.[0]?.codigo,
      pos: entrada.defeitos?.[0]?.posicao ?? entrada.posicoesSPI?.[0],
      tipo: entrada.defeitos?.[0]?.tipo,
    })
    if (!val.ok) return { ok: false, erro: val.erro }
  }

  // Config da OP.
  const ordem = await carregarOrdem(entrada.pmo, entrada.op)
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }

  // Faixa de SN (OP sem faixa → barra).
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  if (!serieDentroDaFaixa(ordem.sn_ini, ordem.sn_fim, entrada.numeroSerie)) {
    return { ok: false, erro: 'Nº de Série fora da faixa desta OP.' }
  }

  // Posto aplicável.
  const aplicavel = (posto: string) => ordem.postos.includes(posto)
  if (!aplicavel(entrada.posto)) {
    return { ok: false, erro: 'Este posto não se aplica a esta OP.' }
  }

  // Posto anterior EXIGIDO = o imediatamente anterior na ORDEM da OP (Plano B2).
  const prevPosto = postoAnteriorNaSequencia(entrada.posto, ordem.postos)
  const perfilPrev = prevPosto ? (mapa[prevPosto] ?? PERFIL_PADRAO) : null

  // Burn-in: entrada/saída via RPC dedicada sf_burnin (lifecycle próprio).
  if (ehBurnin) {
    const evento: 'entrada' | 'saida' = entrada.burninEvento === 'saida' ? 'saida' : 'entrada'
    if (evento === 'saida') {
      const st = (entrada.status ?? '').trim()
      if (st !== 'Aprovado' && st !== 'Reprovado') {
        return { ok: false, erro: 'Informe Aprovado ou Reprovado na saída do Burn-in.' }
      }
    }
    const linhasBurn =
      evento === 'saida'
        ? montarLinhasPerfil(perfil, { status: entrada.status ?? '', defeitos: entrada.defeitos })
        : []
    const rb = await chamarSfBurnin({
      p_evento: evento,
      p_pmo: entrada.pmo,
      p_op: entrada.op,
      p_cliente: ordem.cliente,
      p_colaborador: entrada.colaborador.trim(),
      p_sn: limparSerie(entrada.numeroSerie),
      p_sn_norm: normalizarSerie(entrada.numeroSerie),
      p_status: evento === 'saida' ? (entrada.status ?? '') : '',
      p_prev_posto: prevPosto ?? '',
      p_prev_precisa_aprovado: perfilPrev ? perfilPrecisaAprovado(perfilPrev) : false,
      p_exige_manutencao: perfilExigeManutencao(perfil),
      p_linhas: linhasBurn,
      p_posto: entrada.posto,
    })
    if (!rb.ok) return { ok: false, erro: MENSAGENS[rb.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }
    return { ok: true }
  }

  const qtdPorCaixa =
    entrada.qtdPorCaixa && entrada.qtdPorCaixa.trim() !== '' ? Number(entrada.qtdPorCaixa) : null

  // Recurso "caixa" (Embalagem) exige quantidade por caixa numérica e positiva (evita NaN furar o limite).
  if (perfil.recurso === 'caixa') {
    if (qtdPorCaixa === null || !Number.isInteger(qtdPorCaixa) || qtdPorCaixa <= 0) {
      return { ok: false, erro: 'Informe uma quantidade por caixa válida (inteiro maior que zero).' }
    }
  }

  // NQA não tem campo Status: deriva aprovado/reprovado de visual+funcional.
  // Paridade com o legado: Funcional "Não aplicável" também conta como aprovado.
  const ehNqa = perfil.recurso === 'nqa'
  const nqaFuncionalNorm = (entrada.nqaFuncional ?? '').toLowerCase()
  const statusFinal = ehNqa
    ? (entrada.nqaVisual ?? '').toLowerCase() === 'aprovado' &&
      (nqaFuncionalNorm === 'aprovado' || nqaFuncionalNorm === 'não aplicável')
      ? 'Aprovado'
      : 'Reprovado'
    : (entrada.status ?? '')

  const linhas = montarLinhasPerfil(perfil, {
    status: statusFinal,
    defeitos: entrada.defeitos,
    posicoes: entrada.posicoesSPI,
  })

  const r = await chamarSfLancar({
    p_pmo: entrada.pmo,
    p_op: entrada.op,
    p_cliente: ordem.cliente,
    p_posto: entrada.posto,
    p_colaborador: entrada.colaborador.trim(),
    p_numero_serie: limparSerie(entrada.numeroSerie),
    p_numero_serie_norm: normalizarSerie(entrada.numeroSerie),
    p_status: statusFinal,
    p_posto_tem_status: perfilTemStatus(perfil),
    p_numero_caixa: entrada.numeroCaixa ?? '',
    p_qtd_por_caixa: qtdPorCaixa,
    p_nqa_visual: entrada.nqaVisual ?? '',
    p_nqa_funcional: entrada.nqaFuncional ?? '',
    p_prev_posto: prevPosto ?? '',
    p_prev_precisa_aprovado: perfilPrev ? perfilPrecisaAprovado(perfilPrev) : false,
    p_linhas: linhas,
    p_exige_manutencao: perfilExigeManutencao(perfil),
  })

  if (!r.ok) return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }

  // Auditoria de conserto confirmado (só quando o operador confirmou no diálogo, ao aprovar).
  // Secundária: se falhar, o lançamento já ocorreu — não bloqueia o chão de fábrica.
  if (entrada.conservoConfirmado?.length) {
    try {
      await inserirConservoConfirmado(
        entrada.conservoConfirmado.map((d) => ({
          colaborador: entrada.colaborador.trim(), pmo: entrada.pmo, op: entrada.op,
          numeroSerie: limparSerie(entrada.numeroSerie), numeroSerieNorm: normalizarSerie(entrada.numeroSerie),
          posto: entrada.posto, codigo: d.codigo, posicao: d.posicao, tipo: d.tipo,
        })),
      )
    } catch {
      // ignora: auditoria é secundária
    }
  }

  return { ok: true, caixaCount: r.caixa_count }
}

/**
 * Ao aprovar: se o posto pede confirmação de conserto (coleta defeito + sem manutenção) e o
 * último registro da peça neste posto foi uma reprova, devolve os defeitos a confirmar. Senão, null.
 * Fail-open: erro no lookup não bloqueia (retorna null).
 */
export async function verificarConserto(
  pmo: string, op: string, numeroSerie: string, posto: string,
): Promise<DefeitoConfirmavel[] | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return null
  try {
    const mapa = await mapaPostoPerfil()
    const perfil = mapa[posto] ?? PERFIL_PADRAO
    if (!perfilPedeConfirmacaoConserto(perfil)) return null
    return await buscarUltimaReprovaDoPosto(pmo, op, normalizarSerie(numeroSerie), posto)
  } catch {
    return null
  }
}

export async function buscarEntradaBurnin(pmo: string, op: string, numeroSerie: string, posto: string): Promise<string | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return null

  try {
    const snNorm = normalizarSerie(numeroSerie)
    return await buscarEntradaBurninAberta(pmo, op, snNorm, posto)
  } catch {
    return null // fail-open: erro no lookup não bloqueia o operador (é só aviso)
  }
}
