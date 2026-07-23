'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { normalizarSerie, limparSerie } from '../domain/serie'
import { agruparPendencias, type Ocorrencia } from '../domain/manutencao-pendencias'
import { carregarOrdem } from '../infra/lancamento-repository'
import {
  listarReprovasOrigem,
  listarReparos,
  chamarSfRegistrarReparo,
} from '../infra/manutencao-repository'

const MENSAGENS: Record<string, string> = {
  SEM_PERMISSAO: 'Você não tem permissão para esta ação.',
  SEM_CONSERTOS: 'Informe ao menos um conserto.',
  ERRO_INTERNO: 'Não foi possível concluir a operação.',
}

export async function listarOcorrencias(): Promise<
  { ok: true; ocorrencias: Ocorrencia[] } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }
  try {
    const [reprovas, reparos] = await Promise.all([listarReprovasOrigem(), listarReparos()])
    return { ok: true, ocorrencias: agruparPendencias(reprovas, reparos) }
  } catch {
    return { ok: false, erro: MENSAGENS.ERRO_INTERNO! }
  }
}

export interface EntradaReparo {
  colaborador: string
  ocorrencia: { pmo: string; op: string; sn: string; posto: string; dataHora: string; cod: string; pos: string; tipo: string }
  consertos: { descricao: string; posicao: string }[]
}

export async function registrarReparo(
  entrada: EntradaReparo,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'lancar')) {
    return { ok: false, erro: MENSAGENS.SEM_PERMISSAO! }
  }

  const colaborador = entrada.colaborador.trim()
  const o = entrada.ocorrencia
  const consertos = entrada.consertos
    .map((c) => ({ descricao: c.descricao.trim(), posicao: c.posicao.trim() }))
    .filter((c) => c.descricao !== '')
  if (!colaborador) return { ok: false, erro: 'Informe o colaborador.' }
  if (!o.pmo || !o.op || !o.sn || !o.posto || !o.dataHora) {
    return { ok: false, erro: 'Ocorrência inválida.' }
  }
  if (consertos.length === 0) return { ok: false, erro: MENSAGENS.SEM_CONSERTOS! }

  const ordem = await carregarOrdem(o.pmo, o.op)

  const r = await chamarSfRegistrarReparo({
    p_colaborador: colaborador,
    p_pmo: o.pmo,
    p_op: o.op,
    p_cliente: ordem?.cliente ?? '',
    p_sn: limparSerie(o.sn),
    p_sn_norm: normalizarSerie(o.sn),
    p_cod: o.cod,
    p_pos: o.pos,
    p_tipo: o.tipo,
    p_posto_origem: o.posto,
    p_data_hora_origem: o.dataHora,
    p_consertos: consertos,
  })
  if (!r.ok) return { ok: false, erro: MENSAGENS[r.erro ?? 'ERRO_INTERNO'] ?? MENSAGENS.ERRO_INTERNO! }

  await registrarLog({
    entidade: 'sf_reparo',
    entidadeId: `${o.pmo}/${o.op}/${o.sn}`,
    acao: 'criar',
    descricao: `Reparo de ${o.sn} (${o.pmo}/${o.op}, origem ${o.posto}): ${consertos.length} conserto(s)`,
    dados: { ocorrencia: o, consertos },
  })
  return { ok: true }
}
