'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import {
  atualizarTamanhoNqa,
  buscarCriticidadePorId,
  buscarNqaPorId,
  criarCriticidade,
  excluirCriticidade as excluirCriticidadeRepo,
} from '../infra/referencias-admin-repository'

export type ResultadoAcaoReferencia = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para administrar essas referências.'

export async function salvarCriticidade(
  _prev: ResultadoAcaoReferencia | undefined,
  formData: FormData,
): Promise<ResultadoAcaoReferencia> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const fornecedor = String(formData.get('fornecedor') ?? '').trim()

  if (!fornecedor) return { erro: 'Informe o fornecedor.' }

  let novo: { id: string }
  try {
    novo = await criarCriticidade(fornecedor)
  } catch {
    return { erro: 'Não foi possível criar. Verifique se o fornecedor já está cadastrado.' }
  }

  await registrarLog({
    entidade: 'criticidade',
    entidadeId: novo.id,
    acao: 'criar',
    descricao: `Fornecedor crítico "${fornecedor}" cadastrado`,
    dados: { fornecedor },
  })

  revalidatePath('/configuracoes/criticidade')
  return { ok: true }
}

export async function excluirCriticidade(id: string): Promise<ResultadoAcaoReferencia> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const alvo = await buscarCriticidadePorId(id)
  if (!alvo) return { erro: 'Registro não encontrado.' }

  try {
    await excluirCriticidadeRepo(id)
  } catch {
    return { erro: 'Não foi possível excluir o registro.' }
  }

  await registrarLog({
    entidade: 'criticidade',
    entidadeId: id,
    acao: 'excluir',
    descricao: `Criticidade de "${alvo.fornecedor}" excluída`,
  })

  revalidatePath('/configuracoes/criticidade')
  return { ok: true }
}

export async function salvarTamanhoNqa(
  _prev: ResultadoAcaoReferencia | undefined,
  formData: FormData,
): Promise<ResultadoAcaoReferencia> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const id = String(formData.get('id') ?? '').trim()
  if (!id) return { erro: 'Faixa inválida.' }

  const tamanhoTexto = String(formData.get('tamanho_amostra') ?? '').trim()
  const tamanho = tamanhoTexto ? Number(tamanhoTexto) : null
  if (tamanho !== null && (!Number.isFinite(tamanho) || tamanho < 0)) {
    return { erro: 'Informe um tamanho de amostra válido.' }
  }

  const antes = await buscarNqaPorId(id)
  if (!antes) return { erro: 'Faixa não encontrada.' }

  try {
    await atualizarTamanhoNqa(id, tamanho)
  } catch {
    return { erro: 'Não foi possível salvar o tamanho da amostra.' }
  }

  const diff = calcularDiff(
    antes as unknown as Record<string, unknown>,
    { ...antes, tamanhoAmostra: tamanho } as unknown as Record<string, unknown>,
    ['tamanhoAmostra'],
  )
  const faixa =
    antes.quantidadeMax === null
      ? `${antes.quantidadeMin}+`
      : `${antes.quantidadeMin}–${antes.quantidadeMax}`
  await registrarLog({
    entidade: 'nqa',
    entidadeId: id,
    acao: 'alterar_campo',
    descricao: `Tamanho da amostra da faixa "${faixa}" alterado`,
    dados: diff,
  })

  revalidatePath('/configuracoes/nqa')
  return { ok: true }
}
