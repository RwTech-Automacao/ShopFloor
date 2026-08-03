import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'

export interface EstadoEmbalagem {
  seq: number            // caixa atual (aberta ou próxima a abrir)
  limite: number | null  // null = ainda não definido (operador digita)
  qtdNaCaixa: number     // peças na caixa atual
  totalEmbaladas: number // todas as peças embaladas nesta OP+posto
  ultimasSns: string[]   // últimos SNs da caixa atual (mais recentes primeiro)
  concluida: boolean     // última caixa já foi fechada
}

interface CaixaRow { seq: number; limite: number; fechada: boolean; ultima: boolean }

export async function carregarEstadoEmbalagem(pmo: string, op: string, posto: string): Promise<EstadoEmbalagem> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,limite,fechada,ultima')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).order('seq', { ascending: true })
  if (e1) throw e1
  const caixas = (caixasData ?? []) as CaixaRow[]
  const ultima = caixas[caixas.length - 1]

  const { count: total, error: eTot } = await supabase
    .from('sf_registros').select('*', { count: 'exact', head: true })
    .eq('pmo', pmo).eq('op', op).eq('posto', posto)
  if (eTot) throw eTot
  const totalEmbaladas = total ?? 0

  // concluída: a última caixa está fechada e marcada como última
  if (ultima && ultima.fechada && ultima.ultima) {
    return { seq: ultima.seq, limite: ultima.limite, qtdNaCaixa: 0, totalEmbaladas, ultimasSns: [], concluida: true }
  }

  // caixa atual: última aberta, ou a próxima (seq+1) se a última está fechada
  const abertaExiste = ultima && !ultima.fechada
  const seq = !ultima ? 1 : (ultima.fechada ? ultima.seq + 1 : ultima.seq)
  const limite = ultima ? ultima.limite : null

  let qtdNaCaixa = 0
  let ultimasSns: string[] = []
  if (abertaExiste) {
    const marc = marcadorCaixaAberta(seq)
    const { data: regs, error: eReg } = await supabase
      .from('sf_registros').select('numero_serie,data_hora')
      .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_caixa', marc)
      .order('data_hora', { ascending: false })
    if (eReg) throw eReg
    const rows = (regs ?? []) as { numero_serie: string; data_hora: string }[]
    qtdNaCaixa = rows.length
    ultimasSns = rows.slice(0, 8).map((r) => r.numero_serie)
  }

  return { seq, limite, qtdNaCaixa, totalEmbaladas, ultimasSns, concluida: false }
}

/** Cria a linha da caixa (seq, limite) se ainda não existir. Idempotente. */
export async function garantirCaixa(pmo: string, op: string, posto: string, seq: number, limite: number): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_caixas')
    .upsert({ pmo, op, posto, seq, limite }, { onConflict: 'pmo,op,posto,seq', ignoreDuplicates: true })
  if (error) throw error
}

export async function chamarFecharCaixa(pmo: string, op: string, posto: string, seq: number, ultima: boolean): Promise<{ ok: boolean; erro?: string; codigo?: string }> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_fechar_caixa', { p_pmo: pmo, p_op: op, p_posto: posto, p_seq: seq, p_ultima: ultima })
  if (error) return { ok: false, erro: 'ERRO_INTERNO' }
  return data as { ok: boolean; erro?: string; codigo?: string }
}

export interface OpComCaixa { pmo: string; op: string; cliente: string }
export interface CaixaConsulta {
  seq: number
  posto: string
  fechada: boolean
  limite: number
  codigo: string   // fechada → código final; aberta → 'CX{seq} (aberta)'
  qtd: number      // nº de peças (contagem real)
  sns: string[]    // SNs dentro da caixa
}

/** OPs que têm ao menos uma caixa (distinct pmo/op), com o cliente (de sf_ordens). */
export async function listarOpsComCaixas(): Promise<OpComCaixa[]> {
  const supabase = await createServerSupabase()
  const { data: cxs, error } = await supabase.from('sf_caixas').select('pmo,op')
  if (error) throw error
  const pares = new Map<string, { pmo: string; op: string }>()
  for (const c of (cxs ?? []) as { pmo: string; op: string }[]) pares.set(`${c.pmo}||${c.op}`, { pmo: c.pmo, op: c.op })
  if (pares.size === 0) return []
  const { data: ord, error: e2 } = await supabase.from('sf_ordens').select('pmo,op,cliente')
  if (e2) throw e2
  const cli = new Map<string, string>()
  for (const o of (ord ?? []) as { pmo: string; op: string; cliente: string }[]) cli.set(`${o.pmo}||${o.op}`, o.cliente)
  return [...pares.values()]
    .map((p) => ({ pmo: p.pmo, op: p.op, cliente: cli.get(`${p.pmo}||${p.op}`) ?? '' }))
    .sort((a, b) => (a.pmo === b.pmo ? a.op.localeCompare(b.op) : a.pmo.localeCompare(b.pmo)))
}

/** Caixas de uma OP (todos os postos), com as peças de cada uma. */
export async function carregarCaixasDaOp(pmo: string, op: string): Promise<CaixaConsulta[]> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,posto,limite,fechada,codigo')
    .eq('pmo', pmo).eq('op', op).order('posto', { ascending: true }).order('seq', { ascending: true })
  if (e1) throw e1
  const caixas = (caixasData ?? []) as { seq: number; posto: string; limite: number; fechada: boolean; codigo: string }[]
  if (caixas.length === 0) return []

  const { data: regsData, error: e2 } = await supabase
    .from('sf_registros').select('numero_serie,numero_caixa,posto,data_hora')
    .eq('pmo', pmo).eq('op', op).like('numero_caixa', 'CX%')
    .order('data_hora', { ascending: true })
  if (e2) throw e2
  // Agrupa por (posto, numero_caixa): o marcador/código da caixa NÃO carrega o posto, então
  // dois postos de perfil caixa poderiam ter 'CX[1]' e as peças se misturariam sem o posto na chave.
  const grupos = new Map<string, string[]>()
  for (const r of (regsData ?? []) as { numero_serie: string; numero_caixa: string; posto: string }[]) {
    const k = `${r.posto}||${r.numero_caixa}`
    const arr = grupos.get(k) ?? []
    arr.push(r.numero_serie)
    grupos.set(k, arr)
  }

  return caixas.map((c) => {
    const chave = c.fechada ? c.codigo : marcadorCaixaAberta(c.seq)
    const sns = grupos.get(`${c.posto}||${chave}`) ?? []
    return {
      seq: c.seq,
      posto: c.posto,
      fechada: c.fechada,
      limite: c.limite,
      codigo: c.fechada ? c.codigo : `CX${c.seq} (aberta)`,
      qtd: sns.length,
      sns,
    }
  })
}
