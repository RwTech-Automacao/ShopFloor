'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { validarConserto } from '@/modules/shopfloor/domain/conserto'
import { inserirConserto, excluirConserto } from '@/modules/shopfloor/infra/consertos-repository'

export type ResultadoAcaoConserto = { ok: true; codigo?: string } | { erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para gerenciar consertos.'

export async function cadastrarConservoAction(
  _prev: ResultadoAcaoConserto | undefined,
  formData: FormData,
): Promise<ResultadoAcaoConserto> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  const v = validarConserto({ codigo: String(formData.get('codigo') ?? '') })
  if (!v.ok) return { erro: v.erro }

  const r = await inserirConserto(v.valor)
  if (!r.ok) return { erro: r.erro }

  await registrarLog({
    entidade: 'sf_conserto',
    entidadeId: v.valor.codigo,
    acao: 'criar',
    descricao: `Conserto "${v.valor.codigo}" cadastrado`,
    dados: { codigo: v.valor.codigo },
  })

  revalidatePath('/configuracoes/sf-consertos')
  return { ok: true, codigo: v.valor.codigo }
}

export async function excluirConservoAction(codigo: string): Promise<ResultadoAcaoConserto> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'administrar')) {
    return { erro: SEM_PERMISSAO }
  }

  try {
    await excluirConserto(codigo)
  } catch {
    return { erro: 'Erro ao excluir o conserto.' }
  }

  await registrarLog({
    entidade: 'sf_conserto',
    entidadeId: codigo,
    acao: 'excluir',
    descricao: `Conserto "${codigo}" excluído`,
    dados: { codigo },
  })

  revalidatePath('/configuracoes/sf-consertos')
  return { ok: true }
}
