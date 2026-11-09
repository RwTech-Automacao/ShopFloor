import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { corteDeExpediente } from '../domain/horas-de-turno'
import {
  lerListaDeRegras, lerRegraDoRelatorio, lerSnsParados, montarRelatorioParados,
  type RegraDaLista, type RegraDoRelatorio, type RelatorioParados,
} from '../domain/parados-relatorio'

export type LeituraRelatorioParados =
  | { ok: true; regra: RegraDoRelatorio; relatorio: RelatorioParados; agora: Date }
  | { ok: false; motivo: 'regra_inexistente' }

const PAGINA = 1000
/** Teto de segurança da tela (50 páginas). Uma regra com mais peças paradas que isso é caso de investigar à parte. */
const LIMITE_SNS = 50_000

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A tela "Peças paradas" de uma regra, com a SESSÃO do usuário (as duas funções conferem
 * tem_permissao('shopfloor','visualizar') no banco). O corte é calculado como no avaliador do alerta
 * (`repositorio-servico.ts`, calcularParados): `corteDeExpediente(agora, limite_horas * 60, turnos)`.
 * Diferença deliberada: a tela mostra o estado de agora também no fim de semana (o cron não avalia).
 */
export async function lerRelatorioParados(
  regraId: string,
  agora: Date = new Date(),
  sb?: SupabaseClient,
): Promise<LeituraRelatorioParados> {
  if (!RE_UUID.test(regraId)) return { ok: false, motivo: 'regra_inexistente' }
  const cliente = sb ?? (await createServerSupabase())

  const { data: bruto, error } = await cliente.rpc('alerta_parado_regra', { p_regra: regraId })
  if (error) throw new Error(`alerta_parado_regra: ${error.message}`)
  const lida = lerRegraDoRelatorio(bruto)
  if (!lida.ok) {
    if (lida.motivo === 'regra_inexistente') return { ok: false, motivo: 'regra_inexistente' }
    throw new Error('alerta_parado_regra: resposta ilegível')
  }
  const regra = lida.valor

  const corte = corteDeExpediente(agora, regra.limiteHoras * 60, regra.turnos)
  // Paginado: o PostgREST corta cada resposta no max-rows (1000 no Supabase). A função já devolve numa ordem
  // fixa (mais antiga primeiro, desempate PMO/OP/SN), então as páginas não se sobrepõem.
  const linhas: unknown[] = []
  for (let de = 0; de < LIMITE_SNS; de += PAGINA) {
    const { data, error: erroSns } = await cliente
      .rpc('alerta_parado_sns', { p_regra: regraId, p_corte: corte.toISOString() })
      .range(de, de + PAGINA - 1)
    if (erroSns) throw new Error(`alerta_parado_sns: ${erroSns.message}`)
    const pagina = (data ?? []) as unknown[]
    linhas.push(...pagina)
    if (pagina.length < PAGINA) break
  }

  return { ok: true, regra, relatorio: montarRelatorioParados(lerSnsParados(linhas), regra.turnos, agora), agora }
}

/**
 * As regras "Parado ou travado" ATIVAS (id e nome) para o seletor da aba, com a SESSÃO do usuário. A RLS de
 * alerta_regras só deixa ler quem administra; a `alerta_parado_regras_lista` (0179) confere
 * tem_permissao('shopfloor','visualizar') e devolve só id e nome.
 */
export async function listarRegrasParado(sb?: SupabaseClient): Promise<RegraDaLista[]> {
  const cliente = sb ?? (await createServerSupabase())
  const { data, error } = await cliente.rpc('alerta_parado_regras_lista')
  if (error) throw new Error(`alerta_parado_regras_lista: ${error.message}`)
  return lerListaDeRegras(data)
}
