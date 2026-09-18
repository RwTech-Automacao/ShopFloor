'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { normalizarSerie } from '../domain/serie'
import { gerarFaixaSNsPagina, totalFaixaSNs, montarGrade, montarResumoPorPosto, type LinhaGrade, type ResumoPosto } from '../domain/grade'
import { PERFIL_PADRAO, perfilTemStatus } from '../domain/perfil-posto'
import { carregarOrdem } from '../infra/lancamento-repository'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  buscarRegistrosPorSn,
  listarRegistrosDaOp,
  listarDefeitosDaOp,
  resumoDefeitosDaOp,
  type RegistroHistorico,
  type DefeitoDaOp,
  type ResumoDefeito,
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

/** Página de Defeitos da OP (lazy load): devolve até `limite` linhas a partir de `offset` +
 *  `temMais` (se veio a página cheia, provavelmente há mais). Mais recentes primeiro.
 *  `limite` existe porque a tela do Fluxo mostra só os últimos 6 (o resto vira ranking agregado);
 *  teto em DEFEITOS_PAGINA pra ninguém pedir a OP inteira por aqui. */
export async function carregarDefeitosDaOp(
  pmo: string,
  op: string,
  offset = 0,
  posto = '',
  limite = DEFEITOS_PAGINA,
  /** ISO: só defeitos a partir deste instante (o painel usa a última hora). */
  desde = '',
): Promise<{ ok: true; linhas: DefeitoDaOp[]; temMais: boolean } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  const qtd = Math.min(Math.max(1, Math.trunc(limite)), DEFEITOS_PAGINA)
  try {
    const linhas = await listarDefeitosDaOp(pmo.trim(), op.trim(), Math.max(0, offset), qtd, posto, desde)
    return { ok: true, linhas, temMais: linhas.length === qtd }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}

/** Ranking de defeitos da OP (agregado no banco): total por código + ocorrências na última hora.
 *  Alimenta o painel de ranking e o destaque do defeito campeão da hora na lista. */
export async function carregarResumoDefeitos(
  pmo: string,
  op: string,
  posto = '',
): Promise<{ ok: true; resumo: ResumoDefeito[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, resumo: await resumoDefeitosDaOp(pmo.trim(), op.trim(), posto) }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}

/** Carrega a OP (com faixa de SN) + registros + perfis — base comum da grade paginada e da completa. */
async function baseDaGrade(pmo: string, op: string) {
  const ordem = await carregarOrdem(pmo, op)
  if (!ordem) return { ok: false as const, erro: 'OP não encontrada.' }
  if (ordem.sn_ini.trim() === '' || ordem.sn_fim.trim() === '') {
    return { ok: false as const, erro: 'Esta OP não tem faixa de Nº de Série cadastrada.' }
  }
  return { ok: true as const, ordem }
}

async function registrosEPerfis(pmo: string, op: string) {
  const [registros, mapa] = await Promise.all([listarRegistrosDaOp(pmo, op), mapaPostoPerfil()])
  const temStatus = (posto: string) => perfilTemStatus(mapa[posto] ?? PERFIL_PADRAO)
  return { registros, temStatus }
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

  const base = await baseDaGrade(pmo.trim(), op.trim())
  if (!base.ok) return base
  const { ordem } = base
  const tam = Math.max(1, Math.floor(tamanho))
  const pag = Math.max(1, Math.floor(pagina))
  const faixa = gerarFaixaSNsPagina(ordem.sn_ini, ordem.sn_fim, (pag - 1) * tam, tam)
  if (!faixa.ok) return faixa

  try {
    const { registros, temStatus } = await registrosEPerfis(pmo.trim(), op.trim())
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

/** Teto de SNs pra carregar a OP inteira no cliente (filtro por coluna). */
const MAX_SNS_FILTRO = 5000

/**
 * Grade da OP INTEIRA (todas as linhas), usada pelo filtro por coluna estilo Excel: o pendente pode
 * estar em qualquer página, então o cliente filtra e pagina localmente. Mesma montagem da paginada.
 */
export async function carregarGradeCompleta(
  pmo: string,
  op: string,
): Promise<{ ok: true; colunas: string[]; linhas: LinhaGrade[]; total: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }

  const base = await baseDaGrade(pmo.trim(), op.trim())
  if (!base.ok) return base
  const { ordem } = base
  const tot = totalFaixaSNs(ordem.sn_ini, ordem.sn_fim)
  if (!tot.ok) return tot
  if (tot.total > MAX_SNS_FILTRO) {
    return { ok: false, erro: `OP grande demais pra filtrar por coluna (${tot.total} SNs; máximo ${MAX_SNS_FILTRO}).` }
  }
  const faixa = gerarFaixaSNsPagina(ordem.sn_ini, ordem.sn_fim, 0, tot.total)
  if (!faixa.ok) return faixa

  try {
    const { registros, temStatus } = await registrosEPerfis(pmo.trim(), op.trim())
    return {
      ok: true,
      colunas: [...ordem.postos, 'Manutenção'],
      linhas: montarGrade(faixa.sns, ordem.postos, registros, temStatus),
      total: faixa.total,
    }
  } catch {
    return { ok: false, erro: ERRO_INTERNO }
  }
}
