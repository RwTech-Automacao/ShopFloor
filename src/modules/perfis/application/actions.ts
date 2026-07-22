'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { validarEdicaoPerfil } from '../domain/regras-perfil'
import {
  atualizarPerfil,
  buscarPerfil,
  criarPerfil,
  excluirPerfil as excluirPerfilRepo,
  ERRO_PERFIL_BLOQUEADO_EXCLUSAO,
  type DadosPerfil,
} from '../infra/perfil-repository'

export type ResultadoAcaoPerfil = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para administrar perfis.'

const CAMPOS_DIFF = [
  'nome',
  'pode_visualizar',
  'pode_importar',
  'pode_editar',
  'pode_finalizar',
  'pode_editar_finalizado',
  'pode_excluir',
  'pode_gerar_etiqueta',
  'pode_administrar',
  'pode_lancar',
]

// Detecta violação de unicidade (constraint `perfis_nome_key`) para
// retornar uma mensagem amigável em vez do erro genérico de salvamento.
function eNomeDuplicado(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false
  const codigo = 'code' in e ? (e as { code?: string }).code : undefined
  if (codigo === '23505') return true
  const mensagem = 'message' in e ? String((e as { message?: unknown }).message ?? '') : ''
  return /duplicate key|unique/i.test(mensagem)
}

function lerFlags(formData: FormData): Omit<DadosPerfil, 'nome'> {
  return {
    pode_visualizar: formData.get('visualizar') === 'on',
    pode_importar: formData.get('importar') === 'on',
    pode_editar: formData.get('editar') === 'on',
    pode_finalizar: formData.get('finalizar') === 'on',
    pode_editar_finalizado: formData.get('editar_finalizado') === 'on',
    pode_excluir: formData.get('excluir') === 'on',
    pode_gerar_etiqueta: formData.get('gerar_etiqueta') === 'on',
    pode_administrar: formData.get('administrar') === 'on',
    pode_lancar: formData.get('lancar') === 'on',
  }
}

export async function salvarPerfil(
  _prev: ResultadoAcaoPerfil | undefined,
  formData: FormData,
): Promise<ResultadoAcaoPerfil> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const id = String(formData.get('id') ?? '').trim()
  const nome = String(formData.get('nome') ?? '').trim()
  if (!nome) {
    return { erro: 'Informe um nome para o perfil.' }
  }

  const dados: DadosPerfil = { nome, ...lerFlags(formData) }

  if (id) {
    const validacao = validarEdicaoPerfil({
      perfilAlvoId: id,
      perfilDoUsuarioId: sessao.perfil.id,
      administrarNasNovasFlags: dados.pode_administrar,
    })
    if (!validacao.ok) return { erro: validacao.erro }

    const antes = await buscarPerfil(id)
    if (!antes) return { erro: 'Perfil não encontrado.' }

    try {
      await atualizarPerfil(id, dados)
    } catch (e) {
      if (eNomeDuplicado(e)) return { erro: 'Já existe um perfil com esse nome.' }
      return { erro: 'Não foi possível salvar o perfil.' }
    }

    const diff = calcularDiff(
      antes as unknown as Record<string, unknown>,
      { ...antes, ...dados } as unknown as Record<string, unknown>,
      CAMPOS_DIFF,
    )
    await registrarLog({
      entidade: 'perfil',
      entidadeId: id,
      acao: 'alterar_campo',
      descricao: `Perfil "${dados.nome}" alterado`,
      dados: diff,
    })
  } else {
    let novo: { id: string }
    try {
      novo = await criarPerfil(dados)
    } catch (e) {
      if (eNomeDuplicado(e)) return { erro: 'Já existe um perfil com esse nome.' }
      return { erro: 'Não foi possível criar o perfil.' }
    }

    await registrarLog({
      entidade: 'perfil',
      entidadeId: novo.id,
      acao: 'criar',
      descricao: `Perfil "${dados.nome}" criado`,
      dados,
    })
  }

  revalidatePath('/configuracoes/perfis')
  return { ok: true }
}

export async function excluirPerfil(id: string): Promise<ResultadoAcaoPerfil> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const alvo = await buscarPerfil(id)
  if (!alvo) return { erro: 'Perfil não encontrado.' }

  try {
    await excluirPerfilRepo(id)
  } catch (e) {
    if (e instanceof Error && e.message === ERRO_PERFIL_BLOQUEADO_EXCLUSAO) {
      return { erro: 'Perfis do sistema não podem ser excluídos.' }
    }
    return { erro: 'Não foi possível excluir o perfil.' }
  }

  await registrarLog({
    entidade: 'perfil',
    entidadeId: id,
    acao: 'excluir',
    descricao: `Perfil "${alvo.nome}" excluído`,
  })

  revalidatePath('/configuracoes/perfis')
  return { ok: true }
}
