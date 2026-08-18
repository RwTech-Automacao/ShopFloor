'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { chamarCorrigirImportacao, chamarImportarProcessos } from '../infra/importacao-repository'

export async function importarPlanilha(payload: {
  arquivoNome: string
  formato: 'xlsx' | 'csv'
  mapeamento: Record<string, string>
  linhas: Record<string, string | number | null>[]
}): Promise<
  { ok: true; importacaoId: string; total: number } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'importar')) {
    return { ok: false, erro: 'Você não tem permissão para importar.' }
  }
  if (payload.linhas.length === 0) return { ok: false, erro: 'Nenhuma linha para importar.' }
  try {
    const r = await chamarImportarProcessos(payload)
    return { ok: true, importacaoId: r.importacaoId, total: r.total }
  } catch {
    return { ok: false, erro: 'Falha ao importar. Nenhum dado foi gravado.' }
  }
}

/**
 * Corrige (reimporta substituindo) todos os processos de uma importação/EMB.
 * Só funciona se nada da EMB saiu de 'aberto' — a RPC bloqueia (backstop) e a
 * tela pré-checa. Nada é alterado em caso de erro.
 */
export async function corrigirImportacao(payload: {
  importacaoId: string
  arquivoNome: string
  formato: 'xlsx' | 'csv'
  mapeamento: Record<string, string>
  linhas: Record<string, string | number | null>[]
}): Promise<
  { ok: true; antes: number; total: number } | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'importar')) {
    return { ok: false, erro: 'Você não tem permissão para corrigir importações.' }
  }
  if (payload.linhas.length === 0) return { ok: false, erro: 'Nenhuma linha para importar.' }
  try {
    const r = await chamarCorrigirImportacao(payload)
    return { ok: true, antes: r.antes, total: r.total }
  } catch (e) {
    // A RPC bloqueia quando alguém já começou a conferir (corrida) — mensagem útil.
    const bruto = e instanceof Error ? e.message : ''
    if (bruto.includes('bloquead')) {
      return {
        ok: false,
        erro: 'Correção bloqueada: algum item desta EMB já entrou em conferência. Recarregue a página.',
      }
    }
    return { ok: false, erro: 'Falha ao corrigir. Nenhum dado foi alterado.' }
  }
}
