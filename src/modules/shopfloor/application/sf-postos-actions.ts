'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  criarPosto,
  atualizarPosto,
  excluirPosto,
  postoEmUsoEmOrdem,
  listarPerfis,
} from '@/modules/shopfloor/infra/postos-repository'
import { listarPostos } from '@/modules/shopfloor/infra/ordem-repository'

export type ResultadoAcaoPosto = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar postos.'

export async function cadastrarPostoAction(
  _prev: ResultadoAcaoPosto | undefined,
  formData: FormData,
): Promise<ResultadoAcaoPosto> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const chave = String(formData.get('chave') ?? '').trim()
  const perfil = String(formData.get('perfil') ?? '').trim()

  if (!chave) return { erro: 'Informe o nome do posto.' }

  const perfis = await listarPerfis()
  if (!perfis.some((p) => p.chave === perfil)) return { erro: 'Selecione um perfil válido.' }

  // Ordem de catálogo é automática: entra no fim da lista (não é a sequência da OP).
  const postos = await listarPostos()
  const ordem = postos.reduce((maior, p) => Math.max(maior, p.ordem), 0) + 1

  try {
    await criarPosto({ chave, ordem, perfil })
  } catch (e) {
    const err = e as { code?: string }
    if (err.code === '23505') return { erro: 'Já existe um posto com esse nome.' }
    throw e
  }

  await registrarLog({
    entidade: 'sf_posto',
    entidadeId: chave,
    acao: 'criar',
    descricao: `Posto "${chave}" cadastrado (perfil ${perfil})`,
    dados: { chave, ordem, perfil },
  })

  revalidatePath('/configuracoes/sf-postos')
  return { ok: true }
}

export async function atualizarPostoAction(
  chave: string,
  dados: { ordem: number; perfil: string },
): Promise<ResultadoAcaoPosto> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  if (await postoEmUsoEmOrdem(chave)) {
    return { erro: 'Posto em uso em uma OP — não pode editar.' }
  }

  if (!Number.isFinite(dados.ordem) || !Number.isInteger(dados.ordem)) {
    return { erro: 'Informe uma ordem válida.' }
  }

  const perfis = await listarPerfis()
  if (!perfis.some((p) => p.chave === dados.perfil)) return { erro: 'Selecione um perfil válido.' }

  try {
    await atualizarPosto(chave, dados)
  } catch {
    return { erro: 'Não foi possível editar o posto.' }
  }

  await registrarLog({
    entidade: 'sf_posto',
    entidadeId: chave,
    acao: 'alterar_campo',
    descricao: `Posto "${chave}" editado (ordem ${dados.ordem}, perfil ${dados.perfil})`,
    dados,
  })

  revalidatePath('/configuracoes/sf-postos')
  return { ok: true }
}

export async function excluirPostoAction(chave: string): Promise<ResultadoAcaoPosto> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  if (await postoEmUsoEmOrdem(chave)) {
    return { erro: 'Posto em uso em uma OP — não pode excluir.' }
  }

  try {
    await excluirPosto(chave)
  } catch {
    return { erro: 'Não foi possível excluir o posto.' }
  }

  await registrarLog({
    entidade: 'sf_posto',
    entidadeId: chave,
    acao: 'excluir',
    descricao: `Posto "${chave}" excluído`,
    dados: { chave },
  })

  revalidatePath('/configuracoes/sf-postos')
  return { ok: true }
}
