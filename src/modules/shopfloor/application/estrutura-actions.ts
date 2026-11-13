'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { registrarLog } from '@/modules/logs/application/registrar-log'
import { ClienteCompels } from '@/modules/compels/infra/cliente'
import { configDoAmbiente } from '@/modules/compels/infra/config'
import { casarTrechos, trechosDaArvore, validarParaAtivar, type NoArvore, type TrechoReceita } from '../domain/estrutura'
import { mapaPostoPerfil } from '../infra/postos-repository'
import {
  copiarParaOp, estruturaDaPmo, gravarFilhas, listarEstruturas, marcarAtiva, rotaDeReferencia, salvarEstrutura, ultimaOpNumericaPorPmo,
} from '../infra/estrutura-repository'

type Resultado<T = object> = ({ ok: true } & T) | { ok: false; erro: string }
const SEM_PERMISSAO = 'Você não tem permissão para gerenciar estruturas.'
const numeroDaOp = (op: string) => Number(/^(\d+)/.exec(op.trim())?.[1] ?? NaN)

async function sessaoAdmin() {
  const s = await getSessao()
  return s && podeNoModulo(s.perfil, 'shopfloor', 'administrar') ? s : null
}

async function descendentes(op: string): Promise<NoArvore[]> {
  const n = numeroDaOp(op)
  if (!Number.isInteger(n)) return []
  const cliente = new ClienteCompels(configDoAmbiente())
  return (await cliente.lerDescendentes(n)).map(({ numero, codigo, descricao, nivel, mae }) => ({ numero, codigo, descricao, nivel, mae }))
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
  const e = await estruturaDaPmo(pmo)
  if (!e) return { ok: false, erro: 'Estrutura não encontrada.' }
  const v = validarParaAtivar(e.trechos, await rotaDeReferencia(pmo), await ehAlmox())
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
  const existentes = new Set((await listarEstruturas()).map((e) => e.pmo))
  let criadas = 0, semFilhas = 0, falhas = 0
  for (const { pmo, op } of await ultimaOpNumericaPorPmo()) {
    if (existentes.has(pmo)) continue
    try {
      const trechos = trechosDaArvore(numeroDaOp(op), await descendentes(op), await rotaDeReferencia(pmo))
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

/**
 * Aplica a receita ATIVA da PMO na OP (cópia + OP filha casada). Nunca derruba a criação da OP: devolve um aviso
 * em texto (ou null). Chamado por criarOrdemAction/editarOrdemAction depois de gravar a OP.
 */
export async function aplicarEstruturaNaOp(ordemId: string, pmo: string, op: string, rota: string[]): Promise<string | null> {
  let copiados: { seq: number; codigo: string }[]
  try {
    copiados = await copiarParaOp(ordemId, pmo, rota)
  } catch {
    return 'Não foi possível aplicar a estrutura da PMO nesta OP.'
  }
  if (copiados.length === 0) return null
  let nos: NoArvore[]
  try {
    nos = await descendentes(op)
  } catch {
    return 'Não foi possível consultar o Compels agora: as OPs filhas serão procuradas quando a OP for salva de novo.'
  }
  const filhas = casarTrechos(copiados, nos)
  try {
    await gravarFilhas(ordemId, filhas)
  } catch {
    return 'Não foi possível gravar as OPs filhas do Compels nesta OP.'
  }
  const faltando = copiados.filter((t) => filhas.get(t.seq) === null).map((t) => t.codigo)
  return faltando.length
    ? `${faltando.join(', ')} não foi encontrada no Compels abaixo da OP ${numeroDaOp(op)}: esse trecho não será apontado até a OP ser salva de novo.`
    : null
}
