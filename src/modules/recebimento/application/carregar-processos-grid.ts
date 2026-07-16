'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { carregarCatalogoColunas, valoresDistintosColuna } from '../infra/processo-repository'

export type ResultadoValores = { ok: true; valores: string[] } | { ok: false; erro: string }

/** Valores distintos de uma coluna, para a lista de checkbox do filtro. */
export async function carregarValoresColuna(campo: string): Promise<ResultadoValores> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para visualizar processos.' }
  }

  try {
    const catalogo = await carregarCatalogoColunas()
    if (!catalogo.some((c) => c.campo === campo)) {
      return { ok: false, erro: 'Coluna inválida.' }
    }
    return { ok: true, valores: await valoresDistintosColuna(campo) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os valores desta coluna.' }
  }
}
