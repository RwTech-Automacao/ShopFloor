import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface ItemIntegracao {
  tipo: 'Produto' | 'Placa'
  pmo: string
  op: string
  sn: string
}

export interface IntegracaoDetalhe {
  codigo: string
  dataHora: string
  colaborador: string
  cliente: string
  pmo: string
  op: string
  posto: string
  produtoSn: string
  qtdPlacas: number
  itens: ItemIntegracao[]
}

interface IntegracaoRow {
  id: string
  codigo: string
  data_hora: string
  colaborador: string
  cliente: string
  pmo: string
  op: string
  produto_sn: string
  qtd_placas: number
  posto: string
}

async function montarDetalhe(row: IntegracaoRow): Promise<IntegracaoDetalhe> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_integracao_itens')
    .select('placa_pmo,placa_op,placa_sn')
    .eq('integracao_id', row.id)
  if (error) throw error
  const placas = (data as { placa_pmo: string; placa_op: string; placa_sn: string }[]).map((i) => ({
    tipo: 'Placa' as const,
    pmo: i.placa_pmo,
    op: i.placa_op,
    sn: i.placa_sn,
  }))
  return {
    codigo: row.codigo,
    dataHora: row.data_hora,
    colaborador: row.colaborador,
    cliente: row.cliente,
    pmo: row.pmo,
    op: row.op,
    posto: row.posto,
    produtoSn: row.produto_sn,
    qtdPlacas: row.qtd_placas,
    itens: [{ tipo: 'Produto', pmo: row.pmo, op: row.op, sn: row.produto_sn }, ...placas],
  }
}

const CAMPOS_HDR = 'id,codigo,data_hora,colaborador,cliente,pmo,op,produto_sn,qtd_placas,posto'

/** TODAS as integrações ATIVAS em que o SN aparece como produto OU placa (produto pode
 *  estar em várias — uma por posto). Dedup por código, ordenadas por data desc. */
export async function buscarIntegracoesPorSn(snNorm: string): Promise<IntegracaoDetalhe[]> {
  const supabase = await createServerSupabase()

  // como PRODUTO (pode haver N)
  const { data: prods, error: e1 } = await supabase
    .from('sf_integracoes')
    .select(CAMPOS_HDR)
    .eq('produto_sn_norm', snNorm)
    .eq('status', 'ATIVA')
  if (e1) throw e1

  // como PLACA
  const { data: itens, error: e2 } = await supabase
    .from('sf_integracao_itens')
    .select('sf_integracoes!inner(id,codigo,data_hora,colaborador,cliente,pmo,op,produto_sn,qtd_placas,posto,status)')
    .eq('placa_sn_norm', snNorm)
    .eq('sf_integracoes.status', 'ATIVA')
  if (e2) throw e2

  const rows: IntegracaoRow[] = [
    ...((prods ?? []) as unknown as IntegracaoRow[]),
    ...((itens ?? []) as unknown as { sf_integracoes: IntegracaoRow }[]).map((i) => i.sf_integracoes),
  ]
  const porCodigo = new Map<string, IntegracaoRow>()
  for (const r of rows) if (!porCodigo.has(r.codigo)) porCodigo.set(r.codigo, r)
  const detalhes = await Promise.all([...porCodigo.values()].map(montarDetalhe))
  return detalhes.sort((a, b) => (a.dataHora < b.dataHora ? 1 : -1))
}

export interface SfIntegrarArgs {
  p_colaborador: string
  p_cliente: string
  p_pmo: string
  p_op: string
  p_produto_sn: string
  p_produto_sn_norm: string
  p_prev_posto: string
  p_prev_precisa_aprovado: boolean
  p_placas: { pmo: string; op: string; sn: string; sn_norm: string }[]
  p_posto: string
}

export async function chamarSfIntegrar(
  args: SfIntegrarArgs,
): Promise<{ ok: boolean; erro?: string; codigo?: string; placa?: string; pmo?: string; posto?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_integrar', args)
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; codigo?: string; placa?: string; pmo?: string; posto?: string }
}

export async function chamarSfCancelarIntegracao(
  codigo: string,
  por: string,
): Promise<{ ok: boolean; erro?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_cancelar_integracao', { p_codigo: codigo, p_por: por })
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string }
}
