'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  camposFaltantesFinalizacao,
  podeFinalizar,
  podeReabrir,
  STATUS_EM_CONFERENCIA,
} from '../domain/ciclo-vida'
import { atualizarProcesso, buscarProcesso, carregarCamposFormulario } from '../infra/processo-detalhe-repository'

export type ResultadoTransicaoProcesso = { ok: true } | { ok: false; erro: string }

function caminhoProcesso(id: string): string {
  return `/recebimento/processos/${id}`
}

/**
 * Finaliza um processo de recebimento (`em_conferencia` → `finalizado`).
 * Exige as permissões `editar` (a mesma que o RLS `processos_update` exige
 * para qualquer gravação) e `finalizar`, e bloqueia se algum campo marcado
 * como `obrigatorio_finalizacao` estiver vazio nos valores já salvos do
 * processo.
 */
export async function finalizarProcesso(id: string): Promise<ResultadoTransicaoProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar') || !podeFazer(sessao.perfil, 'finalizar')) {
    return { ok: false, erro: 'Você não tem permissão para esta ação.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }

  if (!podeFinalizar(processo.status)) {
    return { ok: false, erro: 'Este processo não pode ser finalizado no status atual.' }
  }

  const campos = await carregarCamposFormulario()
  const faltantes = camposFaltantesFinalizacao(processo as unknown as Record<string, unknown>, campos)
  if (faltantes.length > 0) {
    const rotulos = campos.filter((c) => faltantes.includes(c.campo)).map((c) => c.rotulo)
    return { ok: false, erro: `Preencha os campos obrigatórios: ${rotulos.join(', ')}.` }
  }

  const novoStatus = String(processo.resultado ?? '').trim()
  if (!novoStatus) {
    return { ok: false, erro: 'Preencha o Resultado para finalizar.' }
  }

  const statusAnterior = processo.status
  try {
    await atualizarProcesso(id, {
      status: novoStatus,
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
    descricao: `Processo #${processo.numero}: ${statusAnterior} → ${novoStatus}`,
    dados: { de: statusAnterior, para: novoStatus },
  })

  revalidatePath(caminhoProcesso(id))
  return { ok: true }
}

/**
 * Reabre um processo concluído (status terminal → `em_conferencia`). Exige
 * as permissões `editar` (mesma exigência do RLS `processos_update`) e
 * `editar_finalizado`, e só é permitido a partir de um status terminal.
 * Limpa `finalizado_em`/`finalizado_por`, já que o processo deixa de estar
 * concluído.
 */
export async function reabrirProcesso(id: string): Promise<ResultadoTransicaoProcesso> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar') || !podeFazer(sessao.perfil, 'editar_finalizado')) {
    return { ok: false, erro: 'Você não tem permissão para esta ação.' }
  }

  const processo = await buscarProcesso(id)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }

  if (!podeReabrir(processo.status)) {
    return { ok: false, erro: 'Só é possível reabrir um processo concluído.' }
  }

  const statusAnterior = processo.status
  try {
    await atualizarProcesso(id, {
      status: STATUS_EM_CONFERENCIA,
      finalizado_em: null,
      finalizado_por: null,
    })
  } catch {
    return { ok: false, erro: 'Não foi possível reabrir o processo.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: id,
    acao: 'mudar_status',
    descricao: `Processo #${processo.numero}: ${statusAnterior} → em_conferencia`,
    dados: { de: statusAnterior, para: STATUS_EM_CONFERENCIA },
  })

  revalidatePath(caminhoProcesso(id))
  return { ok: true }
}
