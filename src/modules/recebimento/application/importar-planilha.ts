'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { chamarCorrigirImportacao, chamarImportarProcessos, contarProcessosDaEmb } from '../infra/importacao-repository'

/**
 * Quantos processos já existem com esta EMB. A tela usa pra avisar ANTES de a pessoa importar.
 * É só informação: quem realmente barra é o `importarPlanilha`.
 */
export async function conferirEmbRepetida(
  emb: string,
): Promise<{ ok: true; existentes: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'importar')) {
    return { ok: false, erro: 'Você não tem permissão para importar.' }
  }
  try {
    return { ok: true, existentes: await contarProcessosDaEmb(emb) }
  } catch {
    return { ok: false, erro: 'Não foi possível verificar a EMB agora.' }
  }
}

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

  // Trava de EMB repetida. Aconteceu de verdade: a EMB390CA entrou duas vezes em produção e os
  // processos ficaram duplicados — deu backup, ensaio e exclusão em massa pra desfazer.
  //
  // A checagem é AQUI, no servidor, e não só na tela: a tela avisa antes, mas o aviso não impede
  // dois navegadores importando a mesma EMB ao mesmo tempo, nem alguém que ignore o vermelho.
  //
  // Refazer uma EMB continua possível — pelo caminho certo, a CORREÇÃO, que substitui os processos
  // em vez de somar novos. Por isso `corrigirImportacao` não passa por aqui.
  const emb = String(payload.linhas[0]?.numero_emb ?? '').trim()
  if (emb !== '') {
    const existentes = await contarProcessosDaEmb(emb)
    if (existentes > 0) {
      return {
        ok: false,
        erro: `A EMB ${emb} já foi importada (${existentes} ${existentes === 1 ? 'processo' : 'processos'}). `
          + 'Para reenviar a planilha corrigida, use "Corrigir importação" na lista de importações.',
      }
    }
  }

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
