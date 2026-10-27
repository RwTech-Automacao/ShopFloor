import type { SupabaseClient } from '@supabase/supabase-js'

/** Janela em que um registro do NQA ainda conta como "da tentativa que acabou de falhar". */
const JANELA_MS = 15 * 60 * 1000
/** SNs por consulta (limita o tamanho da URL do PostgREST). */
const SNS_POR_CONSULTA = 100

/**
 * Depois de um erro que NÃO é recusa de negócio (gateway 504, queda de rede...), o banco pode ter
 * terminado e gravado mesmo assim. Confere, só por leitura, se TODOS os SNs têm registro do posto
 * NQA com o resultado enviado nos últimos 15 minutos. Devolve quantas PLACAS foram encontradas
 * (`pecas` uma vez por SN; com N = 1 é o nº de SNs distintos) quando todos estão gravados; `null` se
 * faltar algum ou se a leitura falhar
 * (na dúvida, o chamador trata como falha — nunca como sucesso).
 */
export async function nqaJaGravado(
  supabase: SupabaseClient,
  q: { posto: string; pmo: string; op: string; resultado: 'Aprovado' | 'Reprovado'; snsNorm: string[] },
): Promise<number | null> {
  const esperados = [...new Set(q.snsNorm)]
  if (esperados.length === 0) return null
  try {
    const desde = new Date(Date.now() - JANELA_MS).toISOString()
    const achados = new Map<string, number>() // SN → placas (pecas da 1ª linha achada)
    for (let i = 0; i < esperados.length; i += SNS_POR_CONSULTA) {
      const { data, error } = await supabase
        .from('sf_registros')
        .select('numero_serie_norm,pecas')
        .eq('posto', q.posto)
        .eq('pmo', q.pmo)
        .eq('op', q.op)
        .eq('status', q.resultado)
        .in('numero_serie_norm', esperados.slice(i, i + SNS_POR_CONSULTA))
        .gte('data_hora', desde)
      if (error) return null
      for (const l of (data ?? []) as { numero_serie_norm: string; pecas?: number | null }[]) {
        if (!achados.has(l.numero_serie_norm)) achados.set(l.numero_serie_norm, l.pecas ?? 1)
      }
    }
    if (!esperados.every((s) => achados.has(s))) return null
    let placas = 0
    for (const p of achados.values()) placas += p
    return placas
  } catch {
    return null
  }
}
