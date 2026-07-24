'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeFazer } from '@/modules/auth/domain/perfil'
import { listarBurninAberto, type BurninAberto } from '../infra/burnin-repository'

export async function carregarBurninAberto(): Promise<{ ok: true; itens: BurninAberto[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeFazer(sessao.perfil, 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para ver o painel.' }
  }
  try {
    return { ok: true, itens: await listarBurninAberto() }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o painel.' }
  }
}
