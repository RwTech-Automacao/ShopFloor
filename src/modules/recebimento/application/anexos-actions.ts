'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { ehTerminal } from '../domain/ciclo-vida'
import { extensaoDoMime, validarArquivoImagem } from '../domain/anexo'
import { buscarProcesso } from '../infra/processo-detalhe-repository'
import {
  buscarAnexo,
  contarAnexos,
  inserirAnexoMeta,
  removerAnexoMeta,
  removerObjeto,
  subirObjeto,
} from '../infra/anexo-repository'

export type ResultadoAnexo = { ok: true } | { ok: false; erro: string }

const LIMITE_ANEXOS = 3

/**
 * Anexa uma foto a um processo (upload imediato). Gate `editar`; bloqueado em
 * processo terminal; respeita o limite de 3. Sobe o objeto e grava o metadado;
 * se o metadado falhar, remove o objeto (sem órfão no bucket).
 */
export async function anexarFoto(processoId: string, form: FormData): Promise<ResultadoAnexo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para anexar fotos.' }
  }

  const processo = await buscarProcesso(processoId)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }
  if (ehTerminal(processo.status)) {
    return { ok: false, erro: 'Processo concluído: reabra o processo para anexar fotos.' }
  }

  if ((await contarAnexos(processoId)) >= LIMITE_ANEXOS) {
    return { ok: false, erro: `Limite de ${LIMITE_ANEXOS} fotos por processo.` }
  }

  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File)) {
    return { ok: false, erro: 'Nenhum arquivo enviado.' }
  }
  const validacao = validarArquivoImagem(arquivo.type, arquivo.size)
  if (!validacao.ok) return { ok: false, erro: validacao.erro }
  const ext = extensaoDoMime(arquivo.type)! // garantido não-nulo pela validação acima

  const path = `${processoId}/${crypto.randomUUID()}.${ext}`
  try {
    const bytes = await arquivo.arrayBuffer()
    await subirObjeto(path, bytes, arquivo.type)
  } catch {
    return { ok: false, erro: 'Não foi possível enviar a foto.' }
  }

  try {
    await inserirAnexoMeta({
      processoId,
      path,
      nomeOriginal: arquivo.name,
      mime: arquivo.type,
      tamanho: arquivo.size,
      criadoPor: sessao.usuarioId,
    })
  } catch {
    await removerObjeto(path).catch(() => {}) // rollback do objeto órfão
    return { ok: false, erro: 'Não foi possível registrar a foto.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: processoId,
    acao: 'alterar_campo',
    descricao: `Processo #${processo.numero} — foto anexada`,
    dados: { nome: arquivo.name, tamanho: arquivo.size },
  })

  revalidatePath(`/recebimento/processos/${processoId}`)
  return { ok: true }
}

/**
 * Remove uma foto de um processo (imediato). Gate `editar`; bloqueado em
 * processo terminal. Apaga o objeto e o metadado.
 */
export async function removerFoto(anexoId: string): Promise<ResultadoAnexo> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'editar')) {
    return { ok: false, erro: 'Você não tem permissão para remover fotos.' }
  }

  const anexo = await buscarAnexo(anexoId)
  if (!anexo) return { ok: false, erro: 'Anexo não encontrado.' }

  const processo = await buscarProcesso(anexo.processoId)
  if (!processo) return { ok: false, erro: 'Processo não encontrado.' }
  if (ehTerminal(processo.status)) {
    return { ok: false, erro: 'Processo concluído: reabra o processo para remover fotos.' }
  }

  try {
    await removerObjeto(anexo.path)
    await removerAnexoMeta(anexoId)
  } catch {
    return { ok: false, erro: 'Não foi possível remover a foto.' }
  }

  await registrarLog({
    entidade: 'processo',
    entidadeId: anexo.processoId,
    acao: 'excluir',
    descricao: `Processo #${processo.numero} — foto removida`,
    dados: { anexoId },
  })

  revalidatePath(`/recebimento/processos/${anexo.processoId}`)
  return { ok: true }
}
