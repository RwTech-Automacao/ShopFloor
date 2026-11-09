'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import type { EstoqueCompels } from '../domain/estoque-compels'
import { agruparEstoquePendente, resumirPendenteDaOp, type ResumoPendenteOp } from '../domain/estoque-pendente'
import { buscarEstoqueCompels } from '../infra/estoque-compels'
import { listarEstoquePendente } from '../infra/estoque-pendente-repository'

/**
 * Estoque da PMO no Compels, para o card do Fluxo. Quem vê o Fluxo (`shopfloor.visualizar`) pode ver; sem
 * sessão ou sem permissão a resposta é a mesma de "recurso que não existe aqui", sem entregar nada.
 */
export async function lerEstoqueCompelsAction(pmo: string): Promise<EstoqueCompels> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { tipo: 'nao_configurado' }
  return buscarEstoqueCompels(String(pmo ?? ''))
}

/**
 * O que já foi dado entrada no Almoxarifado desta OP e AINDA NÃO chegou ao Compels, para o card Concluído do
 * Fluxo. `null` = nada esperando (ou sem sessão/permissão, ou falha na leitura): o Fluxo simplesmente não mostra
 * o aviso. A mesma leitura e os mesmos motivos da tela de Estoque pendente.
 */
export async function lerPendenteCompelsAction(pmo: string, op: string): Promise<ResumoPendenteOp | null> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return null
  try {
    const { linhas, entradas } = await listarEstoquePendente(100, { pmo: String(pmo ?? ''), op: String(op ?? '') })
    return resumirPendenteDaOp(agruparEstoquePendente(linhas, entradas))
  } catch {
    return null
  }
}
