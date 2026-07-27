'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { chamarImportarProcessos } from '../infra/importacao-repository'

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
