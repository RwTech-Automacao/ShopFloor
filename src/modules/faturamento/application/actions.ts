'use server'

import { revalidatePath } from 'next/cache'
import { getSessao } from '@/modules/auth/application/get-sessao'
import { podeNoModulo } from '@/modules/auth/domain/perfil'
import { configBaixaNf, confirmarSelecao, type ResultadoConfirmacao } from '@/modules/compels/application/baixar-nfs'
import { filaDoUsuario, tirarDaFila } from '../infra/fila-repository'
import { clienteCompelsDoFaturamento } from '../infra/compels'

const ROTA = '/faturamento/baixa-nf'
const SEM_PERMISSAO = 'Você não tem permissão para baixar NF.'
export type ResultadoAcao<T> = { ok: true; valor: T } | { ok: false; erro: string }

/** Teto de notas por confirmação (a confirmação percorre uma a uma no Compels). */
const MAX_NOTAS = 100
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function podeBaixar(): Promise<boolean> {
  const sessao = await getSessao()
  return !!sessao && podeNoModulo(sessao.perfil, 'faturamento', 'baixar')
}

/**
 * "Baixar selecionadas": as notas NA ORDEM em que foram marcadas (a ordem é a prioridade). Com saldo baixa na
 * hora; sem saldo vai para o fim da fila; manual recusa. `COMPELS_BAIXA_NF=simular` faz tudo menos a baixa;
 * sem a variável a ação recusa (a tela já mostra o botão desligado).
 */
export async function confirmarSelecaoAction(notaIds: number[]): Promise<ResultadoAcao<ResultadoConfirmacao[]>> {
  if (!(await podeBaixar())) return { ok: false, erro: SEM_PERMISSAO }
  if (!Array.isArray(notaIds) || notaIds.length === 0 || notaIds.length > MAX_NOTAS ||
      !notaIds.every((n) => Number.isSafeInteger(n) && n > 0)) {
    return { ok: false, erro: 'Seleção inválida.' }
  }
  const config = configBaixaNf()
  if (!config) return { ok: false, erro: 'A baixa de NF está desligada neste ambiente.' }
  const cliente = clienteCompelsDoFaturamento()
  if (!cliente) return { ok: false, erro: 'O Compels não está configurado neste ambiente.' }

  try {
    const r = await confirmarSelecao(cliente, await filaDoUsuario(), notaIds, config)
    for (const n of r) console.log(`[baixa-nf] ${new Date().toISOString()} tela ${config.modo} NF ${n.numero ?? n.notaId}: ${n.resultado} — ${n.detalhe}`)
    revalidatePath(ROTA)
    return { ok: true, valor: r }
  } catch (e) {
    console.error('[baixa-nf] confirmação não aconteceu:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Compels ou fila indisponível. Nada foi baixado; tente de novo em instantes.' }
  }
}

/** "Tirar da fila". Reordenar = tirar e selecionar de novo (vai para o fim). */
export async function tirarDaFilaAction(id: string): Promise<ResultadoAcao<boolean>> {
  if (!(await podeBaixar())) return { ok: false, erro: SEM_PERMISSAO }
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, erro: 'Linha da fila inválida.' }
  try {
    const tirou = await tirarDaFila(id)
    revalidatePath(ROTA)
    return { ok: true, valor: tirou }
  } catch (e) {
    console.error('[baixa-nf] tirar da fila falhou:', e instanceof Error ? e.message : e)
    return { ok: false, erro: 'Não foi possível tirar da fila.' }
  }
}
