'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { codificarEstadoGrid, decodificarEstadoGrid, type EstadoGrid } from '../domain/estado-grid'
import {
  carregarCatalogoColunas,
  listarColunasLista,
  listarProcessosGrid,
  valoresDistintosColuna,
} from '../infra/processo-repository'

export type ResultadoGrid =
  | { ok: true; linhas: Record<string, unknown>[]; total: number }
  | { ok: false; erro: string }

export type ResultadoValores = { ok: true; valores: string[] } | { ok: false; erro: string }

/**
 * Uma página do grid. O `estado` vem do cliente e é **re-validado aqui** contra o catálogo
 * (passa por `decodificar(codificar(...))`): nome de coluna de ordenação/filtro só é aceito
 * se existir no catálogo — o cliente nunca escolhe uma coluna arbitrária.
 */
export async function carregarProcessosGrid(estado: EstadoGrid): Promise<ResultadoGrid> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para visualizar processos.' }
  }

  try {
    const catalogo = await carregarCatalogoColunas()
    const validas = catalogo.map((c) => c.campo)
    const seguro = decodificarEstadoGrid(codificarEstadoGrid(estado), validas)

    const layout = await listarColunasLista()
    const visiveis = layout.filter((c) => c.visivel).map((c) => c.campo)
    const colunas = visiveis.filter((campo) => validas.includes(campo))

    const tiposPorCampo = Object.fromEntries(catalogo.map((c) => [c.campo, c.tipo]))
    const { linhas, total } = await listarProcessosGrid({ estado: seguro, colunas, tiposPorCampo })
    return { ok: true, linhas, total }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar os processos.' }
  }
}

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
