'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { nomePadraoValido } from '../domain/padrao-importacao'
import {
  atualizarPadraoImportacao,
  excluirPadraoImportacao,
  inserirPadraoImportacao,
  listarPadroesImportacao,
  type PadraoImportacao,
} from '../infra/padrao-importacao-repository'

export type ResultadoPadroes =
  | { ok: true; padroes: PadraoImportacao[] }
  | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar padrões.'

/** True quando o erro do Postgres é violação de índice único (nome duplicado). */
function ehViolacaoUnica(erro: unknown): boolean {
  return (
    typeof erro === 'object' &&
    erro !== null &&
    'code' in erro &&
    (erro as { code: unknown }).code === '23505'
  )
}

export async function salvarPadrao(
  nome: string,
  mapeamento: Record<string, string>,
): Promise<ResultadoPadroes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) return { ok: false, erro: SEM_PERMISSAO }
  if (!nomePadraoValido(nome)) return { ok: false, erro: 'Dê um nome ao padrão.' }
  if (Object.keys(mapeamento).length < 1) {
    return { ok: false, erro: 'Mapeie ao menos uma coluna antes de salvar.' }
  }
  try {
    await inserirPadraoImportacao(nome.trim(), mapeamento)
    return { ok: true, padroes: await listarPadroesImportacao() }
  } catch (erro) {
    if (ehViolacaoUnica(erro)) return { ok: false, erro: 'Já existe um padrão com esse nome.' }
    return { ok: false, erro: 'Não foi possível salvar o padrão.' }
  }
}

export async function atualizarPadrao(
  id: string,
  mapeamento: Record<string, string>,
): Promise<ResultadoPadroes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) return { ok: false, erro: SEM_PERMISSAO }
  if (Object.keys(mapeamento).length < 1) {
    return { ok: false, erro: 'Mapeie ao menos uma coluna antes de atualizar.' }
  }
  try {
    await atualizarPadraoImportacao(id, mapeamento)
    return { ok: true, padroes: await listarPadroesImportacao() }
  } catch {
    return { ok: false, erro: 'Não foi possível atualizar o padrão.' }
  }
}

export async function excluirPadrao(id: string): Promise<ResultadoPadroes> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'importar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    await excluirPadraoImportacao(id)
    return { ok: true, padroes: await listarPadroesImportacao() }
  } catch {
    return { ok: false, erro: 'Não foi possível excluir o padrão.' }
  }
}
