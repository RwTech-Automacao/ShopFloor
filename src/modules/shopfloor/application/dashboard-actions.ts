'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { contarPorPosto } from '../domain/dashboard'
import { PERFIL_PADRAO, perfilTemStatus } from '../domain/perfil-posto'
import { carregarOrdem } from '../infra/lancamento-repository'
import { listarContagemDaOp } from '../infra/dashboard-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'

export interface ItemDashboard {
  posto: string
  contagem: number
}

export async function carregarDashboard(
  pmo: string,
  op: string,
  de?: string,
  ate?: string,
): Promise<{ ok: true; itens: ItemDashboard[]; total: number | null } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para ver o dashboard.' }
  }
  const ordem = await carregarOrdem(pmo.trim(), op.trim())
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  try {
    const [registros, mapa] = await Promise.all([
      listarContagemDaOp(pmo.trim(), op.trim(), de || undefined, ate || undefined),
      mapaPostoPerfil(),
    ])
    const temStatus = (posto: string) => perfilTemStatus(mapa[posto] ?? PERFIL_PADRAO)
    const contagens = contarPorPosto(ordem.postos, registros, temStatus)
    const itens = [...ordem.postos, 'Manutenção'].map((posto) => ({ posto, contagem: contagens[posto] ?? 0 }))
    return { ok: true, itens, total: ordem.qtd }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o dashboard.' }
  }
}

// ---------------------------------------------------------------------------
// Dashboard geral (várias OPs)
// ---------------------------------------------------------------------------

// ⚠️ Arquivo 'use server': só pode EXPORTAR funções async. Constante ou tipo exportado daqui
// quebra o build (o Next transforma cada export num endpoint). Por isso `OPS_POR_PAGINA` e os
// tipos vivem no domínio, que cliente e servidor importam à vontade.
import { pivotarGrade, OPS_POR_PAGINA, type FiltroDashboard, type DadosDashboard } from '../domain/dashboard'
import { carregarTotaisDashboard, carregarGradeDashboard, carregarDefeitosDashboard } from '../infra/dashboard-repository'
import { listarPostos } from '../infra/postos-repository'

const TOP_DEFEITOS = 5

/**
 * Carrega o dashboard inteiro numa chamada só.
 *
 * As quatro consultas saem em PARALELO: são independentes e a tela só desenha quando tiver todas —
 * em série, a espera seria a soma em vez do maior. E vêm juntas de propósito: totais, grade e
 * defeitos precisam ser a mesma foto do mesmo filtro, senão os números se contradizem na tela.
 */
export async function carregarDashboardGeral(
  filtro: FiltroDashboard,
  pagina = 0,
): Promise<{ ok: true; dados: DadosDashboard } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) {
    return { ok: false, erro: 'Você não tem permissão para ver o dashboard.' }
  }
  try {
    const offset = Math.max(0, pagina) * OPS_POR_PAGINA
    const [totais, grade, defeitos, postos] = await Promise.all([
      carregarTotaisDashboard(filtro),
      carregarGradeDashboard(filtro, OPS_POR_PAGINA, offset),
      carregarDefeitosDashboard(filtro, TOP_DEFEITOS),
      listarPostos(),
    ])
    return {
      ok: true,
      dados: {
        totais,
        // A ordem das colunas vem do cadastro de postos, não dos dados: assim a tabela mantém a
        // sequência do fluxo mesmo quando uma OP ainda não chegou nos postos do fim.
        grade: pivotarGrade(grade.linhas, postos),
        opsTotal: grade.opsTotal,
        defeitos,
      },
    }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o dashboard.' }
  }
}
