'use server'

import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'
import { carregarEstadoEmbalagem, garantirCaixa, chamarFecharCaixa, carregarCaixasDaOp, type EstadoEmbalagem, type CaixaConsulta } from '@/modules/shopfloor/infra/caixa-repository'
import { lancar } from './lancar-action'

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'

export async function carregarEmbalagem(
  pmo: string, op: string, posto: string,
): Promise<{ ok: true; estado: EstadoEmbalagem } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, estado: await carregarEstadoEmbalagem(pmo.trim(), op.trim(), posto.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar o estado da caixa.' }
  }
}

/** Garante a caixa (seq,limite) e lança a peça nela (reusa sf_lancar via lancar).
 *  `ultima`: a caixa foi marcada como ÚLTIMA → aceita passar do limite (as peças que sobram
 *  vão nela em vez de abrir caixa nova). Continua mandando o qtd_por_caixa (a validação exige),
 *  mas via `permitirExtraCaixa` o lancar passa qtd=null pro RPC → pula a checagem de CAIXA_CHEIA.
 *  (O limite canônico da caixa continua em sf_caixas.limite.) */
export async function embalarPeca(entrada: {
  colaborador: string; pmo: string; op: string; posto: string; seq: number; limite: number; numeroSerie: string; ultima?: boolean
}): Promise<{ ok: true; caixaCount?: number } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  // Valida o limite ANTES de criar a caixa: como garantirCaixa é idempotente (não sobrescreve),
  // um limite inválido gravaria a caixa com limite ruim de forma permanente.
  if (!Number.isInteger(entrada.limite) || entrada.limite <= 0) {
    return { ok: false, erro: 'Limite da caixa inválido.' }
  }
  // Trim consistente: garantirCaixa (sf_caixas) e lancar (sf_registros) precisam da MESMA chave,
  // senão as contagens/fechamento (que trimam) não casam com os registros.
  const pmo = entrada.pmo.trim()
  const op = entrada.op.trim()
  const posto = entrada.posto.trim()
  try {
    await garantirCaixa(pmo, op, posto, entrada.seq, entrada.limite)
  } catch {
    return { ok: false, erro: 'Não foi possível abrir a caixa.' }
  }
  const r = await lancar({
    colaborador: entrada.colaborador,
    posto,
    pmo,
    op,
    numeroSerie: entrada.numeroSerie,
    numeroCaixa: marcadorCaixaAberta(entrada.seq),
    qtdPorCaixa: String(entrada.limite),
    permitirExtraCaixa: entrada.ultima, // última caixa aceita passar do limite
  })
  if (!r.ok) return r
  return { ok: true, caixaCount: r.caixaCount }
}

/** Embalagem INDIVIDUAL (1 produto por caixa): confere se o SN da caixa == SN do produto e, se
 *  bater, registra a peça com numero_caixa = o próprio SN (qtd_por_caixa = 1, sem CX coletiva). */
export async function embalarIndividual(entrada: {
  colaborador: string; pmo: string; op: string; posto: string; numeroSerie: string; numeroSerieCaixa: string
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  if (normalizarSerie(entrada.numeroSerie) !== normalizarSerie(entrada.numeroSerieCaixa)) {
    return { ok: false, erro: 'O Nº de Série da caixa não confere com o do produto.' }
  }
  const r = await lancar({
    colaborador: entrada.colaborador,
    posto: entrada.posto.trim(),
    pmo: entrada.pmo.trim(),
    op: entrada.op.trim(),
    numeroSerie: entrada.numeroSerie,
    numeroCaixa: entrada.numeroSerieCaixa.trim(), // a caixa individual = o próprio SN
    qtdPorCaixa: '1',
  })
  if (!r.ok) return { ok: false, erro: r.erro }
  return { ok: true }
}

export async function fecharCaixa(
  pmo: string, op: string, posto: string, seq: number, ultima: boolean,
): Promise<{ ok: true; codigo: string } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'lancar')) return { ok: false, erro: SEM_PERMISSAO }
  const r = await chamarFecharCaixa(pmo.trim(), op.trim(), posto.trim(), seq, ultima)
  if (!r.ok) return { ok: false, erro: r.erro === 'CAIXA_VAZIA' ? 'A caixa está vazia.' : 'Não foi possível fechar a caixa.' }
  return { ok: true, codigo: r.codigo! }
}

export async function caixasDaOp(
  pmo: string, op: string,
): Promise<{ ok: true; caixas: CaixaConsulta[] } | { ok: false; erro: string }> {
  const sessao = await getSessao()
  if (!sessao || !podeNoModulo(sessao.perfil, 'shopfloor', 'visualizar')) return { ok: false, erro: SEM_PERMISSAO }
  try {
    return { ok: true, caixas: await carregarCaixasDaOp(pmo.trim(), op.trim()) }
  } catch {
    return { ok: false, erro: 'Não foi possível carregar as caixas.' }
  }
}
