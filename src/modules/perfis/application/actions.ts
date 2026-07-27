'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Modulo, type Permissao } from '@/modules/auth/domain/perfil'
import { MODULOS, PERMISSOES_POR_MODULO } from '@/modules/auth/domain/modulos'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { calcularDiff } from '@/modules/logs/domain/diff'
import { validarEdicaoPerfil } from '../domain/regras-perfil'
import {
  atualizarPerfil,
  buscarPerfil,
  criarPerfil,
  excluirPerfil as excluirPerfilRepo,
  sincronizarGrants,
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

type Grant = { modulo: Modulo; permissao: Permissao }

// Lê os grants marcados no FormData: um switch por (módulo, permissão),
// nomeado "<modulo>.<permissao>" — ver PerfilForm (accordion por módulo).
function lerGrants(formData: FormData): Grant[] {
  const grants: Grant[] = []
  for (const modulo of MODULOS) {
    for (const permissao of PERMISSOES_POR_MODULO[modulo.chave]) {
      if (formData.get(`${modulo.chave}.${permissao}`) === 'on') {
        grants.push({ modulo: modulo.chave, permissao })
      }
    }
  }
  return grants
}

// Os pode_* seguem como colunas derivadas (usadas pelo RLS): cada uma vira
// true se a permissão correspondente foi concedida em QUALQUER módulo (OR).
function calcularFlags(grants: Grant[]): Omit<DadosPerfil, 'nome'> {
  const concedida = (permissao: Permissao) => grants.some((g) => g.permissao === permissao)
  return {
    pode_visualizar: concedida('visualizar'),
    pode_importar: concedida('importar'),
    pode_editar: concedida('editar'),
    pode_finalizar: concedida('finalizar'),
    pode_editar_finalizado: concedida('editar_finalizado'),
    pode_excluir: concedida('excluir'),
    pode_gerar_etiqueta: concedida('gerar_etiqueta'),
    pode_administrar: concedida('administrar'),
    pode_lancar: concedida('lancar'),
  }
}

export async function salvarPerfil(
  _prev: ResultadoAcaoPerfil | undefined,
  formData: FormData,
): Promise<ResultadoAcaoPerfil> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'sistema', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const id = String(formData.get('id') ?? '').trim()
  const nome = String(formData.get('nome') ?? '').trim()
  if (!nome) {
    return { erro: 'Informe um nome para o perfil.' }
  }

  const grants = lerGrants(formData)
  const dados: DadosPerfil = { nome, ...calcularFlags(grants) }

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
      await sincronizarGrants(id, grants)
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
      await sincronizarGrants(novo.id, grants)
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
  if (!sessao || !podeNoModulo(sessao.perfil, 'sistema', 'administrar')) {
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
