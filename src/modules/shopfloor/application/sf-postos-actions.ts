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
import { perfilAtribuivel, perfilSuportaColetivo } from '@/modules/shopfloor/domain/perfil-posto'

export type ResultadoAcaoPosto = { ok: true; nome?: string } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar postos.'

/** Só marca coletivo=true se o perfil escolhido permitir (gate server-side). */
function coletivoPermitido(perfilChave: string, coletivo: boolean): boolean {
  return coletivo && perfilSuportaColetivo(perfilChave)
}

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
  const coletivo = coletivoPermitido(perfil, formData.get('coletivo') === 'on')

  if (!chave) return { erro: 'Informe o nome do posto.' }

  const perfis = await listarPerfis()
  const perfilEscolhido = perfis.find((p) => p.chave === perfil)
  if (!perfilEscolhido || !perfilAtribuivel(perfilEscolhido)) return { erro: 'Selecione um perfil válido.' }

  // Ordem de catálogo é automática: entra no fim da lista (não é a sequência da OP).
  const postos = await listarPostos()
  const ordem = postos.reduce((maior, p) => Math.max(maior, p.ordem), 0) + 1

  try {
    await criarPosto({ chave, ordem, perfil, coletivo })
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
    dados: { chave, ordem, perfil, coletivo },
  })

  revalidatePath('/configuracoes/sf-postos')
  return { ok: true, nome: chave }
}

export async function atualizarPostoAction(
  chave: string,
  dados: { perfil: string; coletivo?: boolean },
): Promise<ResultadoAcaoPosto> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  if (await postoEmUsoEmOrdem(chave)) {
    return { erro: 'Posto em uso em uma OP — não pode editar.' }
  }

  // Editar só troca o perfil (a ordem de catálogo é interna/automática, não é editável).
  const perfis = await listarPerfis()
  if (!perfis.some((p) => p.chave === dados.perfil)) return { erro: 'Selecione um perfil válido.' }

  // Invariante amarrada ao PERFIL, sempre recalculada (nunca fica coletivo=true obsoleto
  // depois de trocar pra um perfil que não suporta lançamento coletivo).
  const coletivo = perfilSuportaColetivo(dados.perfil) ? (dados.coletivo ?? false) : false

  try {
    await atualizarPosto(chave, { perfil: dados.perfil, coletivo })
  } catch {
    return { erro: 'Não foi possível editar o posto.' }
  }

  await registrarLog({
    entidade: 'sf_posto',
    entidadeId: chave,
    acao: 'alterar_campo',
    descricao: `Posto "${chave}" editado (perfil ${dados.perfil})`,
    dados: { ...dados, coletivo },
  })

  revalidatePath('/configuracoes/sf-postos')
  return { ok: true, nome: chave }
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
