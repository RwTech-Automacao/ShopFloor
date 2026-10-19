import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export async function lerRegistroParaCancelar(
  id: string,
): Promise<{ pmo: string; op: string; numeroSerieNorm: string; posto: string; numeroCaixa: string } | null> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('pmo,op,numero_serie_norm,posto,numero_caixa')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as { pmo: string; op: string; numero_serie_norm: string; posto: string; numero_caixa: string | null }
  // numero_caixa: é por ele que se acha a caixa a reabrir no cancelamento. Não é mais só a embalagem
  // que preenche — o bipe de caixa no Almoxarifado grava uma linha por peça com o código da caixa
  // (0129), então existe linha com numero_caixa fora da Embalagem. Quem decide reabrir é o RECURSO do
  // perfil do posto ('caixa'), conferido dentro da sf_cancelar_lancamento (0106): cancelar uma linha
  // de almoxarifado não mexe em caixa nenhuma.
  return { pmo: r.pmo, op: r.op, numeroSerieNorm: r.numero_serie_norm, posto: r.posto, numeroCaixa: r.numero_caixa ?? '' }
}

/** É o bipe mais recente (maior data_hora, depois id) do SN nesta OP? */
export async function ehUltimoBipe(
  pmo: string, op: string, numeroSerieNorm: string, id: string,
): Promise<boolean> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('id')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', numeroSerieNorm)
    .order('data_hora', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
  if (error) throw error
  const ultimo = (data ?? [])[0] as { id: string } | undefined
  return ultimo?.id === id
}

export async function chamarSfCancelar(
  id: string, motivo: string,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.rpc('sf_cancelar_lancamento', { p_id: id, p_motivo: motivo })
  if (error) return { ok: false, erro: error.message }
  return { ok: true }
}

/**
 * Quantas peças a entrada de caixa do Almoxarifado tem: as linhas daquela caixa NAQUELE posto — o
 * conjunto exato que a 0131 vai cancelar. Serve pro diálogo dizer "14 peças" ANTES de confirmar.
 *
 * É best-effort de UX: o número que vale é o que a RPC devolve depois de apagar (ela conta dentro da
 * trava). Este aqui é lido fora de trava e pode estar velho por um instante.
 */
export async function contarPecasDaEntradaDeCaixa(
  pmo: string, op: string, posto: string, numeroCaixa: string,
): Promise<number> {
  if (numeroCaixa.trim() === '') return 0 // numero_caixa='' casaria com toda entrada individual
  const supabase = await createServerSupabase()
  const { count, error } = await supabase
    .from('sf_registros')
    .select('*', { count: 'exact', head: true })
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_caixa', numeroCaixa)
  if (error) throw error
  return count ?? 0
}

/**
 * Cancela a CAIXA INTEIRA (0131): as N linhas da entrada, de uma vez, com um motivo só. Devolve
 * quantas linhas saíram — é o que a tela mostra ("14 peças canceladas").
 */
export async function chamarSfCancelarCaixa(
  id: string, motivo: string,
): Promise<{ ok: true; canceladas: number } | { ok: false; erro: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_cancelar_caixa_almoxarifado', {
    p_id: id, p_motivo: motivo,
  })
  if (error) return { ok: false, erro: error.message }
  return { ok: true, canceladas: Number(data ?? 0) }
}

/** Uma linha do log de cancelamentos (auditoria), já achatada pra exibição. */
export interface CancelamentoRow {
  id: string
  canceladoEm: string
  motivo: string
  pmo: string
  op: string
  posto: string
  sn: string
  statusOriginal: string
  colaboradorOriginal: string
  canceladoPor: string // nome de quem cancelou (ou '—' se não resolver)
}

/** Log de cancelamentos (mais recente primeiro). Resolve o nome de quem cancelou (best-effort). */
export async function listarCancelamentos(limite = 200): Promise<CancelamentoRow[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros_cancelados')
    .select('id, cancelado_em, motivo, pmo, op, posto, cancelado_por, dados')
    .order('cancelado_em', { ascending: false })
    .limit(limite)
  if (error) throw error
  const linhas = (data ?? []) as {
    id: string; cancelado_em: string; motivo: string; pmo: string; op: string; posto: string
    cancelado_por: string | null; dados: Record<string, unknown> | null
  }[]

  // Resolve uuid -> nome de quem cancelou (best-effort; RLS pode limitar → cai em '—').
  const ids = [...new Set(linhas.map((l) => l.cancelado_por).filter((x): x is string => !!x))]
  const nomes = new Map<string, string>()
  if (ids.length > 0) {
    const { data: us } = await supabase.from('usuarios').select('id, nome').in('id', ids)
    for (const u of (us ?? []) as { id: string; nome: string }[]) nomes.set(u.id, u.nome)
  }

  return linhas.map((l) => ({
    id: l.id,
    canceladoEm: l.cancelado_em,
    motivo: l.motivo,
    pmo: l.pmo,
    op: l.op,
    posto: l.posto,
    sn: String(l.dados?.numero_serie ?? ''),
    statusOriginal: String(l.dados?.status ?? ''),
    colaboradorOriginal: String(l.dados?.colaborador ?? ''),
    canceladoPor: (l.cancelado_por && nomes.get(l.cancelado_por)) || '—',
  }))
}
