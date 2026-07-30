'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarDefeito } from '@/modules/shopfloor/domain/defeito'
import { inserirDefeito, excluirDefeito } from '@/modules/shopfloor/infra/defeitos-repository'

export type ResultadoAcaoDefeito = { ok: true } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar defeitos.'

export async function cadastrarDefeitoAction(
  _prev: ResultadoAcaoDefeito | undefined,
  formData: FormData,
): Promise<ResultadoAcaoDefeito> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const v = validarDefeito({
    codigo: String(formData.get('codigo') ?? ''),
    tipo: Number(formData.get('tipo')),
  })
  if (!v.ok) return { erro: v.erro }

  const r = await inserirDefeito(v.valor)
  if (!r.ok) return { erro: r.erro }

  await registrarLog({
    entidade: 'sf_defeito',
    entidadeId: v.valor.codigo,
    acao: 'criar',
    descricao: `Defeito "${v.valor.codigo}" (${v.valor.tipo === 1 ? 'peça' : 'teste'}) cadastrado`,
    dados: { codigo: v.valor.codigo, tipo: v.valor.tipo },
  })

  revalidatePath('/configuracoes/sf-defeitos')
  return { ok: true }
}

export async function excluirDefeitoAction(codigo: string): Promise<ResultadoAcaoDefeito> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  try {
    await excluirDefeito(codigo)
  } catch {
    return { erro: 'Erro ao excluir o defeito.' }
  }

  await registrarLog({
    entidade: 'sf_defeito',
    entidadeId: codigo,
    acao: 'excluir',
    descricao: `Defeito "${codigo}" excluído`,
    dados: { codigo },
  })

  revalidatePath('/configuracoes/sf-defeitos')
  return { ok: true }
}
