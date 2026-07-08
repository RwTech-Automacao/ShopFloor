'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { camposFaltantesFinalizacao, podeTransicionar } from '../domain/ciclo-vida'
import { atualizarProcesso, buscarProcesso, carregarCamposFormulario } from '../infra/processo-detalhe-repository'

export type ResultadoTransicaoProcesso = { ok: true } | { ok: false; erro: string }

function caminhoProcesso(id: string): string {
  return `/recebimento/processos/${id}`
}

/**
 * Finaliza um processo de recebimento (`em_conferencia` → `finalizado`).
 * Exige a permissão `finalizar` e bloqueia se algum campo marcado como
 * `obrigatorio_finalizacao` estiver vazio nos valores já salvos do processo.
 */
export async function finalizarProcesso(id: string): Promise<ResultadoTransicaoProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'finalizar')) {
    return { ok: false, erro: 'Você não tem permissão para finalizar processos.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }

  if (!podeTransicionar(processo.status, 'finalizado')) {
    return { ok: false, erro: 'Este processo não pode ser finalizado no status atual.' }
  }

  const campos = await carregarCamposFormulario()
  const faltantes = camposFaltantesFinalizacao(processo as unknown as Record<string, unknown>, campos)
  if (faltantes.length > 0) {
    const rotulos = campos.filter((c) => faltantes.includes(c.campo)).map((c) => c.rotulo)
    return { ok: false, erro: `Preencha os campos obrigatórios: ${rotulos.join(', ')}.` }
  }

  const statusAnterior = processo.status
  try {
    await atualizarProcesso(id, {
      status: 'finalizado',
      finalizado_por: sessao.usuarioId,
      finalizado_em: new Date().toISOString(),
    })
  } catch {
    return { ok: false, erro: 'Não foi possível finalizar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Processo #${processo.numero}: ${statusAnterior} → finalizado`,
    dados: { de: statusAnterior, para: 'finalizado' },
  })

  revalidatePath(caminhoProcesso(id))
  return { ok: true }
}

/**
 * Cancela um processo de recebimento. Exige a permissão `excluir` e um
 * motivo não vazio. `cancelado` é terminal no ciclo de vida.
 */
export async function cancelarProcesso(
  id: string,
  motivo: string,
): Promise<ResultadoTransicaoProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'excluir')) {
    return { ok: false, erro: 'Você não tem permissão para cancelar processos.' }
  }

  const motivoLimpo = motivo.trim()
  if (!motivoLimpo) {
    return { ok: false, erro: 'Informe o motivo do cancelamento.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }

  if (!podeTransicionar(processo.status, 'cancelado')) {
    return { ok: false, erro: 'Este processo não pode ser cancelado no status atual.' }
  }

  const statusAnterior = processo.status
  try {
    await atualizarProcesso(id, {
      status: 'cancelado',
      cancelado_por: sessao.usuarioId,
      motivo_cancelamento: motivoLimpo,
    })
  } catch {
    return { ok: false, erro: 'Não foi possível cancelar o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Processo #${processo.numero}: ${statusAnterior} → cancelado`,
    dados: { de: statusAnterior, para: 'cancelado', motivo: motivoLimpo },
  })

  revalidatePath(caminhoProcesso(id))
  return { ok: true }
}

/**
 * Reabre um processo finalizado (`finalizado` → `em_conferencia`). Exige a
 * permissão `editar_finalizado` e só é permitido a partir do status
 * `finalizado`.
 */
export async function reabrirProcesso(id: string): Promise<ResultadoTransicaoProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar_finalizado')) {
    return { ok: false, erro: 'Você não tem permissão para reabrir processos finalizados.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }

  if (processo.status !== 'finalizado' || !podeTransicionar(processo.status, 'em_conferencia')) {
    return { ok: false, erro: 'Só é possível reabrir um processo finalizado.' }
  }

  try {
    await atualizarProcesso(id, {
      status: 'em_conferencia',
      finalizado_em: null,
    })
  } catch {
    return { ok: false, erro: 'Não foi possível reabrir o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Processo #${processo.numero}: finalizado → em_conferencia`,
    dados: { de: 'finalizado', para: 'em_conferencia' },
  })

  revalidatePath(caminhoProcesso(id))
  return { ok: true }
}
