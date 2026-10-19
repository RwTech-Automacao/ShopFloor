'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import type { EstoqueCompels } from '../domain/estoque-compels'
import { buscarEstoqueCompels } from '../infra/estoque-compels'

/**
 * Estoque da PMO no Compels, para o card do Fluxo. Quem vê o Fluxo (`shopfloor.visualizar`) pode ver; sem
 * sessão ou sem permissão a resposta é a mesma de "recurso que não existe aqui", sem entregar nada.
 */
export async function lerEstoqueCompelsAction(pmo: string): Promise<EstoqueCompels> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { tipo: 'nao_configurado' }
  return buscarEstoqueCompels(String(pmo ?? ''))
}
