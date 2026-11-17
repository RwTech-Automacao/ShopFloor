'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Permissao } from '@/modules/auth/domain/perfil'
import { MAX_RELOGIOS, validarMudancaNf, validarNota, type MudancaNf, type NotaInput, type SituacaoNf } from '../domain/entrada'
import { formatarCnpj } from '../domain/cnpj'
import { mensagemMudancaNf, mensagemNota } from '../domain/mensagens'
import { mensagemDoErro } from '../domain/erros'
import {
  associarOs, consultarNoBanco, corrigirNf, ErroDoBanco, osPorNs, registrarNf, trocarNf,
  type MudancaGravada,
} from '../infra/repository'
import { avisarSat } from '../infra/discord'
import { empresaDoCnpj } from '../infra/compels'
import { consultarNs, type ResultadoConsultaNs } from './consultar-ns'

/**
 * Ações do SAT (spec 2026-11-17-sat-entrada-por-nf-design.md). A permissão é conferida aqui ANTES de tudo e de novo
 * no banco (funções da 0187). O aviso no Discord vem depois da gravação e nunca a impede.
 */
export type ResultadoAcao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'
const CNPJ_INVALIDO = 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXTO = 2000

/** Todas as telas do SAT leem com `sat.visualizar` (RLS); a ação pede também a permissão dela. */
async function pode(perm: Permissao): Promise<boolean> {
  const sessao = await getSessao()
  return !!sessao && podeNoModulo(sessao.perfil, 'sat', 'visualizar') && podeNoModulo(sessao.perfil, 'sat', perm)
}

function falha(e: unknown, generica: string): { ok: false; erro: string } {
  if (e instanceof ErroDoBanco) return { ok: false, erro: mensagemDoErro(e.message, generica) }
  console.error('[sat]', generica, e instanceof Error ? e.message : e)
  return { ok: false, erro: generica }
}

async function avisar(texto: string): Promise<void> {
  try {
    await avisarSat(texto)
  } catch (e) {
    console.error('[sat] aviso no Discord falhou:', e instanceof Error ? e.message : e)
  }
}

const idsValidos = (xs: unknown): xs is string[] =>
  Array.isArray(xs) && xs.length <= 50 && xs.every((x) => typeof x === 'string' && UUID.test(x))
const textoOk = (t: unknown, max = MAX_TEXTO) => typeof t === 'string' && t.length <= max
const idOk = (id: unknown): id is string => typeof id === 'string' && UUID.test(id)
const codigoOk = (c: unknown) => c === null || textoOk(c, 100)

/** A busca do número de série na tela de entrada. */
export async function consultarNsAction(ns: string): Promise<ResultadoAcao<ResultadoConsultaNs>> {
  if (!(await pode('registrar_entrada'))) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof ns !== 'string' || ns.trim() === '' || ns.length > 200) return { ok: false, erro: 'Digite o número de série.' }
  try {
    return { ok: true, valor: await consultarNs(ns, { osPorNs, consultarBanco: consultarNoBanco }) }
  } catch (e) {
    return falha(e, 'Não foi possível buscar o número de série.')
  }
}

/** A empresa da nota pelo CNPJ no Compels; `null` = não achou (ou Compels fora) — a pessoa digita. */
export async function buscarEmpresaAction(cnpj: string): Promise<ResultadoAcao<{ codigo: string; nome: string } | null>> {
  if (!(await pode('registrar_entrada'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!textoOk(cnpj, 50) || formatarCnpj(cnpj) === null) return { ok: false, erro: CNPJ_INVALIDO }
  try {
    return { ok: true, valor: await empresaDoCnpj(cnpj) }
  } catch (e) {
    return falha(e, 'Não foi possível buscar a empresa.')
  }
}

function relogiosNoFormato(xs: unknown): boolean {
  return Array.isArray(xs) && xs.length <= MAX_RELOGIOS && xs.every((r) =>
    !!r && typeof r === 'object' && textoOk(r.ns, 200) && textoOk(r.produto) && textoOk(r.itensJuntoOutros) &&
    textoOk(r.locacao) && Array.isArray(r.itensJunto) && r.itensJunto.length <= 10)
}

/** "Registrar entrada": a nota e todos os relógios dela, numa gravação só; UM aviso no Discord. */
export async function registrarNfAction(input: NotaInput): Promise<ResultadoAcao<{ nfId: string; ids: string[] }>> {
  if (!(await pode('registrar_entrada'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!input || typeof input !== 'object') return { ok: false, erro: 'Entrada inválida.' }
  if (!textoOk(input.numero, 100) || !textoOk(input.cnpj, 50) || !textoOk(input.valor, 50) || !textoOk(input.empresa) ||
      !codigoOk(input.negocianteCodigo) ||
      !idsValidos(input.motivos) || !relogiosNoFormato(input.relogios)) return { ok: false, erro: 'Entrada inválida.' }

  const v = validarNota(input)
  if (!v.ok) return v
  let gravada: Awaited<ReturnType<typeof registrarNf>>
  try {
    gravada = await registrarNf(v.valor)
  } catch (e) {
    return falha(e, 'Não foi possível registrar a entrada.')
  }
  revalidatePath('/sat/equipamentos')
  await avisar(mensagemNota({
    numero: v.valor.numero, empresa: v.valor.empresa, cnpj: v.valor.cnpj, situacao: v.valor.situacao,
    motivos: gravada.motivos, ns: gravada.relogios.map((r) => r.ns),
  }))
  return { ok: true, valor: { nfId: gravada.nfId, ids: gravada.relogios.map((r) => r.id) } }
}

async function mudarNf(tipo: 'correcao' | 'troca', grava: () => Promise<MudancaGravada>): Promise<ResultadoAcao<null>> {
  let m: MudancaGravada
  try {
    m = await grava()
  } catch (e) {
    return falha(e, 'Não foi possível mudar a NF.')
  }
  // A mudança vale para todos os relógios da nota: todas as fichas.
  revalidatePath('/sat/equipamentos/[id]', 'page')
  revalidatePath('/sat/equipamentos')
  await avisar(mensagemMudancaNf({ tipo, ...m }))
  return { ok: true, valor: null }
}

/** "Corrigir NF": a mesma nota muda de situação (ex.: reprovada → aprovada). */
export async function corrigirNfAction(nfId: string, situacao: SituacaoNf, motivos: string[]): Promise<ResultadoAcao<null>> {
  if (!(await pode('aprovar_nf'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(nfId) || !idsValidos(motivos)) return { ok: false, erro: 'Pedido inválido.' }
  const v = validarMudancaNf({ tipo: 'corrigir', situacao, motivos })
  if (!v.ok) return v
  return mudarNf('correcao', () => corrigirNf(nfId, situacao, v.motivos))
}

/** "Trocar NF": nota nova (número, CNPJ, empresa, valor, situação); a antiga fica no histórico. */
export async function trocarNfAction(
  nfId: string, t: Omit<Extract<MudancaNf, { tipo: 'troca' }>, 'tipo'>,
): Promise<ResultadoAcao<null>> {
  if (!(await pode('aprovar_nf'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(nfId) || !t || typeof t !== 'object' || !idsValidos(t.motivos) || !textoOk(t.numero, 100) ||
      !textoOk(t.cnpj, 50) || !textoOk(t.empresa) || !textoOk(t.valor, 50) || !codigoOk(t.negocianteCodigo)) {
    return { ok: false, erro: 'Pedido inválido.' }
  }
  const v = validarMudancaNf({ ...t, tipo: 'troca' })
  if (!v.ok) return v
  return mudarNf('troca', () => trocarNf(nfId, {
    numero: t.numero.trim(), cnpj: v.cnpj!, empresa: t.empresa.trim(), negocianteCodigo: (t.negocianteCodigo ?? '').trim() || null,
    valor: v.valor ?? null, situacao: t.situacao, motivos: v.motivos,
  }))
}

/** "Trocar OS" na ficha: liga o relógio a outra OS do mesmo NS, ou a nenhuma. Vai para o histórico; não avisa no Discord. */
export async function associarOsAction(entradaId: string, osId: string | null): Promise<ResultadoAcao<null>> {
  if (!(await pode('associar_os'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!idOk(entradaId) || (osId !== null && !idOk(osId))) return { ok: false, erro: 'Pedido inválido.' }
  try {
    await associarOs(entradaId, osId)
  } catch (e) {
    return falha(e, 'Não foi possível trocar a OS.')
  }
  revalidatePath(`/sat/equipamentos/${entradaId}`)
  revalidatePath('/sat/equipamentos')
  return { ok: true, valor: null }
}
