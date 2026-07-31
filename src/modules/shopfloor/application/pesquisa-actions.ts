'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { normalizarSerie } from '../domain/serie'
import { gerarFaixaSNs, montarGrade, type LinhaGrade } from '../domain/grade'
import { PERFIL_PADRAO, perfilTemStatus } from '../domain/perfil-posto'
import { carregarOrdem } from '../infra/lancamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  buscarRegistrosPorSn,
  listarRegistrosDaOp,
  type RegistroHistorico,
} from '../infra/pesquisa-repository'

const SEM_PERMISSAO = 'Você não tem permissão para pesquisar.'
const ERRO_INTERNO = 'Não foi possível concluir a consulta.'

export async function buscarHistoricoSN(
  sn: string,
): Promise<{ ok: true; registros: RegistroHistorico[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  const alvo = normalizarSerie(sn)
  if (alvo === '') return { ok: true, registros: [] }
  try {
    return { ok: true, registros: await buscarRegistrosPorSn(alvo) }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}

export async function carregarGrade(
  pmo: string,
  op: string,
): Promise<{ ok: true; colunas: string[]; linhas: LinhaGrade[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }

  const ordem = await carregarOrdem(pmo.trim(), op.trim())
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  const faixa = gerarFaixaSNs(ordem.sn_ini, ordem.sn_fim)
  if (!faixa.ok) return faixa

  try {
    const [registros, mapa] = await Promise.all([
      listarRegistrosDaOp(pmo.trim(), op.trim()),
      mapaPostoPerfil(),
    ])
    const temStatus = (posto: string) => perfilTemStatus(mapa[posto] ?? PERFIL_PADRAO)
    return {
      ok: true,
      colunas: [...ordem.postos, 'Manutenção'],
      linhas: montarGrade(faixa.sns, ordem.postos, registros, temStatus),
    }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}
