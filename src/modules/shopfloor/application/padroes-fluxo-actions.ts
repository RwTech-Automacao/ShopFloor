'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { validarPadraoFluxo } from '@/modules/shopfloor/domain/validar-padrao'
import { upsertPadrao, excluirPadrao } from '@/modules/shopfloor/infra/padroes-fluxo-repository'

type Resultado = { ok: true } | { ok: false; erro: string }

export async function salvarPadraoAction(dados: {
  pmo: string
  nome: string
  descricao: string
  postos: string[]
  componentes: string[]
}): Promise<Resultado> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para gerenciar padrões.' }
  }
  if (dados.pmo.trim() === '') return { ok: false, erro: 'Selecione o PMO antes de salvar o padrão.' }
  const v = validarPadraoFluxo(dados.nome, dados.postos)
  if (!v.ok) return v
  try {
    await upsertPadrao({
      pmo: dados.pmo.trim(),
      nome: dados.nome.trim(),
      descricao: dados.descricao.trim(),
      postos: dados.postos,
      componentes: dados.componentes,
    })
  } catch {
    return { ok: false, erro: 'Erro ao salvar o padrão.' }
  }
  revalidatePath('/shopfloor/ordens')
  return { ok: true }
}

export async function excluirPadraoAction(id: string): Promise<Resultado> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { ok: false, erro: 'Você não tem permissão para gerenciar padrões.' }
  }
  try {
    await excluirPadrao(id)
  } catch {
    return { ok: false, erro: 'Erro ao excluir o padrão.' }
  }
  revalidatePath('/shopfloor/ordens')
  return { ok: true }
}
