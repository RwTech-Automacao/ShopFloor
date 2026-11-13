'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente, ConfiguracaoIncompleta } from '@/modules/compels/infra/config'
import { trechosDaArvore, validarParaAtivar, type TrechoReceita } from '../domain/estrutura'
import { mapaPostoPerfil } from '../infra/postos-repository'
import { descendentes, numeroDaOp } from './aplicar-estrutura'
import {
  estruturaDaPmo, listarEstruturas, marcarAtiva, resumoTrechosDaOp, rotaDeReferencia, salvarEstrutura, ultimaOpNumericaPorPmo,
  type ResumoTrecho,
} from '../infra/estrutura-repository'

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: string }
const SEM_PERMISSAO = 'Você não tem permissão para gerenciar estruturas.'

async function sessaoAdmin() {
  const s = await getSessao()
  return s && podeNoModulo(s.perfil, 'shopfloor', 'administrar') ? s : null
}

const ehAlmox = async () => {
  const perfis = await mapaPostoPerfil()
  return (p: string) => (perfis as Record<string, { recurso?: string }>)[p]?.recurso === 'almoxarifado'
}

export async function salvarEstruturaAction(pmo: string, trechos: TrechoReceita[]): Promise<Resultado> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }
  const alvo = pmo.trim()
  if (!alvo) return { ok: false, erro: 'Informe a PMO.' }
  if (trechos.some((t) => !t.codigo.trim())) return { ok: false, erro: 'Todo trecho precisa do código da PRT.' }
  try {
    await salvarEstrutura(alvo, trechos.map((t, i) => ({ ...t, seq: i + 1 })), s.nome || s.email)
  } catch {
    return { ok: false, erro: 'Não foi possível salvar a estrutura.' }
  }
  await registrarLog({ entidade: 'sf_estrutura', acao: 'alterar_campo', descricao: `Estrutura ${alvo} salva (rascunho)`, dados: { trechos } })
  revalidatePath('/shopfloor/estruturas')
  return { ok: true }
}

export async function ativarEstruturaAction(pmo: string): Promise<Resultado> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }
  let v: ReturnType<typeof validarParaAtivar>
  try {
    const e = await estruturaDaPmo(pmo)
    if (!e) return { ok: false, erro: 'Estrutura não encontrada.' }
    v = validarParaAtivar(e.trechos, await rotaDeReferencia(pmo), await ehAlmox())
  } catch {
    return { ok: false, erro: 'Não foi possível conferir a estrutura agora.' }
  }
  if (!v.ok) return { ok: false, erro: v.erros.join(' ') }
  try {
    await marcarAtiva(pmo, s.nome || s.email)
  } catch {
    return { ok: false, erro: 'Não foi possível ativar a estrutura.' }
  }
  await registrarLog({ entidade: 'sf_estrutura', acao: 'mudar_status', descricao: `Estrutura ${pmo} ativada`, dados: { pmo } })
  revalidatePath('/shopfloor/estruturas')
  return { ok: true }
}

/** "Ler do Compels": os trechos sugeridos a partir de UMA OP da PMO (não grava nada). */
export async function lerDoCompelsAction(pmo: string, op: string): Promise<Resultado<{ trechos: TrechoReceita[] }>> {
  if (!(await sessaoAdmin())) return { ok: false, erro: SEM_PERMISSAO }
  try {
    const nos = await descendentes(op)
    return { ok: true, trechos: trechosDaArvore(numeroDaOp(op), nos, await rotaDeReferencia(pmo.trim())) }
  } catch {
    return { ok: false, erro: 'Não foi possível consultar o Compels agora.' }
  }
}

/** Importa em lote (D9): rascunho para cada PMO do ShopFloor sem estrutura e com filhas no Compels. */
export async function importarDoCompelsAction(): Promise<Resultado<{ criadas: number; semFilhas: number; falhas: number }>> {
  const s = await sessaoAdmin()
  if (!s) return { ok: false, erro: SEM_PERMISSAO }
  let cliente: ClienteCompels
  try {
    cliente = new ClienteCompels(configDoAmbiente())
  } catch (e) {
    if (e instanceof ConfiguracaoIncompleta) return { ok: false, erro: 'A consulta ao Compels não está configurada neste ambiente.' }
    return { ok: false, erro: 'Não foi possível consultar o Compels agora.' }
  }
  let existentes: Set<string>
  let candidatas: { pmo: string; op: string }[]
  try {
    existentes = new Set((await listarEstruturas()).map((e) => e.pmo))
    candidatas = await ultimaOpNumericaPorPmo()
  } catch {
    return { ok: false, erro: 'Não foi possível ler as estruturas e as OPs agora.' }
  }
  let criadas = 0, semFilhas = 0, falhas = 0
  for (const { pmo, op } of candidatas) {
    if (existentes.has(pmo)) continue
    try {
      const trechos = trechosDaArvore(numeroDaOp(op), await descendentes(op, cliente), await rotaDeReferencia(pmo))
      if (trechos.length === 0) { semFilhas++; continue }
      await salvarEstrutura(pmo, trechos, s.nome || s.email, `compels:${numeroDaOp(op)}`)
      criadas++
    } catch {
      falhas++
    }
  }
  await registrarLog({ entidade: 'sf_estrutura', acao: 'importar', descricao: `Estruturas importadas do Compels: ${criadas}`, dados: { criadas, semFilhas, falhas } })
  revalidatePath('/shopfloor/estruturas')
  return { ok: true, criadas, semFilhas, falhas }
}

/** Resumo por trecho (PRT) da OP para o card do Fluxo. Sem sessão ou sem permissão de ver, devolve vazio. */
export async function lerTrechosCompelsAction(pmo: string, op: string): Promise<ResumoTrecho[]> {
  const s = await getSessao()
  if (!s || !podeNoModulo(s.perfil, 'shopfloor', 'visualizar')) return []
  try { return await resumoTrechosDaOp(String(pmo ?? ''), String(op ?? '')) } catch { return [] }
}
