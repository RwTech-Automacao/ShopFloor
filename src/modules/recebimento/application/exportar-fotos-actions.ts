'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import {
  limparFotosDoMes as limparFotosDoMesRepo,
  listarFotosDoMes,
  type FotoExport,
} from '../infra/anexo-export-repository'

export type ResultadoExport = { ok: true; fotos: FotoExport[] } | { ok: false; erro: string }
export type ResultadoLimpeza = { ok: true; removidos: number } | { ok: false; erro: string }

/** Fotos de um mês para montar o ZIP no cliente. Gate `administrar`. */
export async function obterFotosDoMes(mes: string): Promise<ResultadoExport> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para exportar fotos.' }
  }
  try {
    const fotos = await listarFotosDoMes(mes)
    if (fotos.length === 0) return { ok: false, erro: 'Nenhuma foto neste mês.' }
    return { ok: true, fotos }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as fotos do mês.' }
  }
}

/** Apaga as fotos de um mês do Storage e da tabela. Gate `administrar`. */
export async function limparFotosDoMes(mes: string): Promise<ResultadoLimpeza> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'recebimento', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para limpar fotos.' }
  }
  let removidos: number
  try {
    removidos = await limparFotosDoMesRepo(mes)
  } catch {
    return { ok: false, erro: 'Não foi possível limpar as fotos do mês.' }
  }
  await registrarLog({
    entidade: 'processo',
    acao: 'excluir',
    descricao: `Fotos do mês ${mes} removidas (${removidos})`,
    dados: { mes, removidos },
  })
  revalidatePath('/recebimento/exportar-fotos')
  return { ok: true, removidos }
}
