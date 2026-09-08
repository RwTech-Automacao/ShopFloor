'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { normalizarSerie } from '../domain/serie'
import { gerarFaixaSNsPagina, montarGrade, montarResumoPorPosto, type LinhaGrade, type ResumoPosto } from '../domain/grade'
import { PERFIL_PADRAO, perfilTemStatus } from '../domain/perfil-posto'
import { carregarOrdem } from '../infra/lancamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  buscarRegistrosPorSn,
  listarRegistrosDaOp,
  listarDefeitosDaOp,
  type RegistroHistorico,
  type DefeitoDaOp,
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

const DEFEITOS_PAGINA = 100

/** Página de Defeitos da OP (lazy load): devolve até DEFEITOS_PAGINA linhas a partir de `offset` +
 *  `temMais` (se veio a página cheia, provavelmente há mais). Mais recentes primeiro. */
export async function carregarDefeitosDaOp(
  pmo: string,
  op: string,
  offset = 0,
  posto = '',
): Promise<{ ok: true; linhas: DefeitoDaOp[]; temMais: boolean } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const linhas = await listarDefeitosDaOp(pmo.trim(), op.trim(), Math.max(0, offset), DEFEITOS_PAGINA, posto)
    return { ok: true, linhas, temMais: linhas.length === DEFEITOS_PAGINA }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}

export async function carregarGrade(
  pmo: string,
  op: string,
  pagina = 1,
  tamanho = 100,
): Promise<
  | { ok: true; colunas: string[]; resumo: ResumoPosto[]; linhas: LinhaGrade[]; total: number; pagina: number; totalPaginas: number }
  | { ok: false; erro: string }
> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }

  const ordem = await carregarOrdem(pmo.trim(), op.trim())
  if (!ordem) return { ok: false, erro: 'OP não encontrada.' }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  const tam = Math.max(1, Math.floor(tamanho))
  const pag = Math.max(1, Math.floor(pagina))
  const faixa = gerarFaixaSNsPagina(ordem.sn_ini, ordem.sn_fim, (pag - 1) * tam, tam)
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
      resumo: montarResumoPorPosto(faixa.total, ordem.postos, registros, temStatus), // OP inteira (qualquer tamanho)
      linhas: montarGrade(faixa.sns, ordem.postos, registros, temStatus),            // só a página
      total: faixa.total,
      pagina: pag,
      totalPaginas: Math.max(1, Math.ceil(faixa.total / tam)),
    }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}
