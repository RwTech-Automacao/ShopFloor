'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo, type Permissao } from '@/modules/auth/domain/perfil'
import { validarEntrada, validarMudancaNf, type EntradaInput, type SituacaoNf } from '../domain/entrada'
import { mensagemEntrada, mensagemMudancaNf } from '../domain/mensagens'
import { mensagemDoErro } from '../domain/erros'
import {
  consultarNoBanco, corrigirNf, ErroDoBanco, osPorNs, registrarEntrada, salvarMotivo, trocarNf,
  type MudancaGravada,
} from '../infra/repository'
import { avisarSat } from '../infra/discord'
import { descricaoDoProduto } from '../infra/compels'
import { consultarNs, type ResultadoConsultaNs } from './consultar-ns'

/**
 * Ações do SAT (spec 2026-11-17-sat-entrada-design.md). A permissão é conferida aqui ANTES de tudo e de novo no
 * banco (funções da 0186). O aviso no Discord vem depois da gravação e nunca a impede.
 */
export type ResultadoAcao<T> = { ok: true; valor: T } | { ok: false; erro: string }

const SEM_PERMISSAO = 'Você não tem permissão para esta ação.'
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

const textosValidos = (xs: unknown): xs is string[] =>
  Array.isArray(xs) && xs.length <= 50 && xs.every((x) => typeof x === 'string' && UUID.test(x))

/** A busca do número de série na tela de entrada. */
export async function consultarNsAction(ns: string): Promise<ResultadoAcao<ResultadoConsultaNs>> {
  if (!(await pode('registrar_entrada'))) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof ns !== 'string' || ns.trim() === '' || ns.length > 200) return { ok: false, erro: 'Digite o número de série.' }
  try {
    return {
      ok: true,
      valor: await consultarNs(ns, { osPorNs, consultarBanco: consultarNoBanco, descricaoProduto: descricaoDoProduto }),
    }
  } catch (e) {
    return falha(e, 'Não foi possível buscar o número de série.')
  }
}

/** "Salvar entrada". */
export async function registrarEntradaAction(input: EntradaInput): Promise<ResultadoAcao<{ id: string }>> {
  if (!(await pode('registrar_entrada'))) return { ok: false, erro: SEM_PERMISSAO }
  if (!input || typeof input !== 'object') return { ok: false, erro: 'Entrada inválida.' }
  const textos = [input.ns, input.empresa, input.cnpj, input.produto, input.nf, input.valor, input.itensJuntoOutros,
    input.defeito, input.locacao, input.custo]
  if (!textos.every((t) => typeof t === 'string' && t.length <= MAX_TEXTO)) return { ok: false, erro: 'Entrada inválida.' }
  if (input.osId !== null && !(typeof input.osId === 'string' && UUID.test(input.osId))) return { ok: false, erro: 'OS inválida.' }
  if (!textosValidos(input.motivos) || !Array.isArray(input.itensJunto)) return { ok: false, erro: 'Entrada inválida.' }

  const v = validarEntrada(input)
  if (!v.ok) return v
  let gravada: Awaited<ReturnType<typeof registrarEntrada>>
  try {
    gravada = await registrarEntrada(v.valor)
  } catch (e) {
    return falha(e, 'Não foi possível salvar a entrada.')
  }
  revalidatePath('/sat/equipamentos')
  await avisar(mensagemEntrada({
    ns: v.valor.ns, cliente: v.valor.empresa, os: gravada.osNumero, nf: v.valor.nf, situacao: v.valor.situacao,
    motivos: gravada.motivos,
  }))
  return { ok: true, valor: { id: gravada.id } }
}

async function mudarNf(
  entradaId: string, tipo: 'correcao' | 'troca', grava: () => Promise<MudancaGravada>,
): Promise<ResultadoAcao<null>> {
  let m: MudancaGravada
  try {
    m = await grava()
  } catch (e) {
    return falha(e, 'Não foi possível mudar a NF.')
  }
  revalidatePath(`/sat/equipamentos/${entradaId}`)
  revalidatePath('/sat/equipamentos')
  await avisar(mensagemMudancaNf({ tipo, ns: m.ns, cliente: m.empresa, os: m.osNumero, nfDe: m.nfDe, nfPara: m.nfPara,
    situacaoDe: m.situacaoDe, situacaoPara: m.situacaoPara, motivos: m.motivos }))
  return { ok: true, valor: null }
}

/** "Corrigir NF": a mesma nota muda de situação (ex.: reprovada → aprovada). */
export async function corrigirNfAction(entradaId: string, situacao: SituacaoNf, motivos: string[]): Promise<ResultadoAcao<null>> {
  if (!(await pode('aprovar_nf'))) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof entradaId !== 'string' || !UUID.test(entradaId) || !textosValidos(motivos)) return { ok: false, erro: 'Pedido inválido.' }
  const v = validarMudancaNf({ tipo: 'corrigir', situacao, motivos })
  if (!v.ok) return v
  return mudarNf(entradaId, 'correcao', () => corrigirNf(entradaId, situacao, v.motivos))
}

/** "Trocar NF": nota nova; a antiga fica no histórico como substituída. */
export async function trocarNfAction(
  entradaId: string, nf: string, situacao: SituacaoNf, motivos: string[],
): Promise<ResultadoAcao<null>> {
  if (!(await pode('aprovar_nf'))) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof entradaId !== 'string' || !UUID.test(entradaId) || !textosValidos(motivos) ||
      typeof nf !== 'string' || nf.length > 100) return { ok: false, erro: 'Pedido inválido.' }
  const v = validarMudancaNf({ tipo: 'troca', nf, situacao, motivos })
  if (!v.ok) return v
  return mudarNf(entradaId, 'troca', () => trocarNf(entradaId, nf.trim(), situacao, v.motivos))
}

/** Cadastro dos motivos de reprovação (novo: `id` null). */
export async function salvarMotivoAction(id: string | null, texto: string, ativo: boolean): Promise<ResultadoAcao<string>> {
  if (!(await pode('administrar'))) return { ok: false, erro: SEM_PERMISSAO }
  if ((id !== null && !(typeof id === 'string' && UUID.test(id))) || typeof texto !== 'string' || typeof ativo !== 'boolean') {
    return { ok: false, erro: 'Pedido inválido.' }
  }
  const t = texto.trim()
  if (t === '' || t.length > 200) return { ok: false, erro: 'O motivo precisa de um texto (até 200 caracteres).' }
  try {
    const salvo = await salvarMotivo(id, t, ativo)
    revalidatePath('/sat/motivos')
    return { ok: true, valor: salvo }
  } catch (e) {
    return falha(e, 'Não foi possível salvar o motivo.')
  }
}
