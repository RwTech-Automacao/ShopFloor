import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { corteDeExpediente } from '../domain/horas-de-turno'
import type { Intervalo } from '../domain/intervalos'
import { lerRegraDoRelatorio, type RegraDoRelatorio } from '../domain/parados-relatorio'
import { lerPecasParadas, type SituacaoOp, type SnParadoTela } from '../domain/parados-filtros'

const PAGINA = 1000
/** Teto de segurança da tela (50 páginas). Mais peças paradas que isso é caso de investigar à parte. */
const LIMITE_SNS = 50_000

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A regra do link da mensagem (`?regra=<id>`), com a SESSÃO do usuário (alerta_parado_regra, 0177, confere
 * tem_permissao('shopfloor','visualizar')). Ela só preenche os filtros da tela. null = id inválido, regra
 * excluída, inexistente ou de outro tipo.
 */
export async function lerRegraParado(regraId: string, sb?: SupabaseClient): Promise<RegraDoRelatorio | null> {
  if (!RE_UUID.test(regraId)) return null
  const cliente = sb ?? (await createServerSupabase())
  const { data, error } = await cliente.rpc('alerta_parado_regra', { p_regra: regraId })
  if (error) throw new Error(`alerta_parado_regra: ${error.message}`)
  const lida = lerRegraDoRelatorio(data)
  if (!lida.ok) {
    if (lida.motivo === 'regra_inexistente') return null
    throw new Error('alerta_parado_regra: resposta ilegível')
  }
  return lida.valor
}

export interface OpcoesLeituraParados {
  horas: number
  situacao: SituacaoOp
  /** Vazio = todas (o link de uma regra com PMOs passa as da regra). */
  pmos: readonly string[]
  /** Os turnos da regra do link: o tempo conta em horas de expediente. Vazio = relógio corrido. */
  turnos: readonly Intervalo[]
}

/**
 * As peças paradas há mais de `horas` (sf_pecas_paradas, 0180), SN a SN, com a SESSÃO do usuário. O corte é
 * calculado como no avaliador do alerta: `corteDeExpediente(agora, horas * 60, turnos)`.
 */
export async function lerPecasParadasTela(
  o: OpcoesLeituraParados, agora: Date = new Date(), sb?: SupabaseClient,
): Promise<SnParadoTela[]> {
  const cliente = sb ?? (await createServerSupabase())
  const corte = corteDeExpediente(agora, o.horas * 60, o.turnos)
  // Paginado: o PostgREST corta cada resposta no max-rows (1000). A função devolve numa ordem fixa (mais antiga
  // primeiro, desempate PMO/OP/SN), então as páginas não se sobrepõem.
  const linhas: unknown[] = []
  for (let de = 0; de < LIMITE_SNS; de += PAGINA) {
    const { data, error } = await cliente
      .rpc('sf_pecas_paradas', { p_corte: corte.toISOString(), p_situacao: o.situacao, p_pmos: o.pmos.length > 0 ? o.pmos : null })
      .range(de, de + PAGINA - 1)
    if (error) throw new Error(`sf_pecas_paradas: ${error.message}`)
    const pagina = (data ?? []) as unknown[]
    linhas.push(...pagina)
    if (pagina.length < PAGINA) break
  }
  return lerPecasParadas(linhas)
}
