import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { marcadorCaixaAberta, derivarEstadoCaixas, seqDoMarcadorCaixa, type LinhaCaixa } from '@/modules/shopfloor/domain/caixa'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

export interface EstadoEmbalagem {
  seq: number            // caixa atual (aberta ou próxima a abrir)
  limite: number | null  // null = ainda não definido (operador digita)
  qtdNaCaixa: number     // peças na caixa atual
  totalEmbaladas: number // todas as peças embaladas nesta OP+posto
  snsNaCaixa: string[]   // todos os SNs da caixa atual (mais recentes primeiro)
  concluida: boolean     // última caixa já foi fechada
  caixasReabertas: CaixaReaberta[] // caixas abertas por cancelamento (fora da caixa atual)
}

/** Caixa que voltou a ficar ABERTA porque um bipe dela foi cancelado (0098). Ela não toma o lugar
 *  da caixa atual: fica pendente, o operador escolhe entrar nela pra completar e fechar de novo.
 *  Vem com os SNs porque a tela mostra o mesmo quadro da caixa atual, e reabertas são poucas e
 *  pequenas (no máximo o limite da caixa). */
export interface CaixaReaberta {
  seq: number
  limite: number
  qtd: number
  sns: string[] // mais recentes primeiro
}

export async function carregarEstadoEmbalagem(pmo: string, op: string, posto: string): Promise<EstadoEmbalagem> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,limite,fechada,ultima')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).order('seq', { ascending: true })
  if (e1) throw e1
  const caixas = (caixasData ?? []) as LinhaCaixa[]
  const d = derivarEstadoCaixas(caixas)

  const { count: total, error: eTot } = await supabase
    .from('sf_registros').select('*', { count: 'exact', head: true })
    .eq('pmo', pmo).eq('op', op).eq('posto', posto)
  if (eTot) throw eTot
  const totalEmbaladas = total ?? 0

  // SNs de TODAS as caixas abertas (atual + reabertas) numa consulta só — cada caixa aberta carrega
  // o marcador CX[seq] nos seus registros, então dá pra buscar por `in` e agrupar aqui.
  const marcadorAtual = d.atualAberta ? marcadorCaixaAberta(d.seq) : null
  const marcadores = [
    ...(marcadorAtual ? [marcadorAtual] : []),
    ...d.reabertas.map((c) => marcadorCaixaAberta(c.seq)),
  ]
  const porMarcador = new Map<string, string[]>()
  if (marcadores.length > 0) {
    const { data: regs, error: eReg } = await supabase
      .from('sf_registros').select('numero_serie,numero_caixa,data_hora')
      .eq('pmo', pmo).eq('op', op).eq('posto', posto).in('numero_caixa', marcadores)
      .order('data_hora', { ascending: false })
    if (eReg) throw eReg
    for (const r of (regs ?? []) as { numero_serie: string; numero_caixa: string }[]) {
      const arr = porMarcador.get(r.numero_caixa) ?? []
      arr.push(r.numero_serie)
      porMarcador.set(r.numero_caixa, arr)
    }
  }

  const caixasReabertas: CaixaReaberta[] = d.reabertas.map((c) => {
    const sns = porMarcador.get(marcadorCaixaAberta(c.seq)) ?? []
    return { seq: c.seq, limite: c.limite, qtd: sns.length, sns }
  })
  const snsNaCaixa = marcadorAtual ? (porMarcador.get(marcadorAtual) ?? []) : []

  return {
    seq: d.seq,
    limite: d.limite,
    qtdNaCaixa: snsNaCaixa.length,
    totalEmbaladas,
    snsNaCaixa,
    concluida: d.concluida,
    caixasReabertas,
  }
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

export interface OpComCaixa {
  pmo: string
  op: string
  cliente: string
  descricao: string // produto (vai na faixa do cabeçalho da folha impressa)
  qtdOp: number | null // total da OP — NÃO é a quantidade da caixa
}
export interface CaixaConsulta {
  seq: number
  posto: string
  fechada: boolean
  limite: number
  codigo: string   // fechada → código final; aberta → 'CX{seq} (aberta)'
  qtd: number      // nº de peças (contagem real)
  sns: string[]    // SNs dentro da caixa
}

/** OPs que têm ao menos uma caixa (distinct pmo/op), com cliente/produto/qtd (de sf_ordens). */
export async function listarOpsComCaixas(): Promise<OpComCaixa[]> {
  const supabase = await createServerSupabase()
  const { data: cxs, error } = await supabase.from('sf_caixas').select('pmo,op')
  if (error) throw error
  const pares = new Map<string, { pmo: string; op: string }>()
  for (const c of (cxs ?? []) as { pmo: string; op: string }[]) pares.set(`${c.pmo}||${c.op}`, { pmo: c.pmo, op: c.op })
  if (pares.size === 0) return []
  const { data: ord, error: e2 } = await supabase.from('sf_ordens').select('pmo,op,cliente,descricao,qtd')
  if (e2) throw e2
  type Ordem = { pmo: string; op: string; cliente: string; descricao: string; qtd: number | null }
  const porOp = new Map<string, Ordem>()
  for (const o of (ord ?? []) as Ordem[]) porOp.set(`${o.pmo}||${o.op}`, o)
  return [...pares.values()]
    .map((p) => {
      const o = porOp.get(`${p.pmo}||${p.op}`)
      return {
        pmo: p.pmo,
        op: p.op,
        cliente: o?.cliente ?? '',
        descricao: o?.descricao ?? '',
        qtdOp: o?.qtd ?? null,
      }
    })
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

export interface CaixaDoSn {
  posto: string        // posto de embalagem onde a caixa foi formada
  numeroCaixa: string  // código/marcador da caixa (numero_caixa)
  qtd: number          // total de peças (SNs distintos) da caixa
  snsNorm: string[]    // SNs (normalizados) da caixa — p/ validar que a amostra é DESTA caixa
  fechada: boolean     // a caixa já foi FECHADA na embalagem (NQA só inspeciona caixa fechada)
  jaInspecionadaNqa: boolean // caixa FINALIZADA no NQA (alguma peça no NQA e NENHUMA pendente de reteste)
  pendentesReteste: string[] // SNs (exibição) que ainda precisam RETESTAR antes de re-inspecionar a caixa
  postoReteste: string       // posto onde essas peças devem retestar (1º da rota; vazio se não uniforme)
}

/**
 * Dado 1 SN, acha a CAIXA a que ele pertence (via `numero_caixa` da embalagem) + a quantidade e
 * se já foi inspecionada no posto NQA (`postoNqa`). Base do painel NQA por caixa. Null se o SN não
 * está em nenhuma caixa.
 */
export async function resolverCaixaPorSn(
  pmo: string,
  op: string,
  sn: string,
  postoNqa: string,
): Promise<CaixaDoSn | null> {
  const supabase = await createServerSupabase()
  const norm = normalizarSerie(sn)

  const { data: r1, error: e1 } = await supabase
    .from('sf_registros')
    .select('numero_caixa,posto')
    .eq('pmo', pmo).eq('op', op).eq('numero_serie_norm', norm)
    .like('numero_caixa', 'CX%')
    .order('data_hora', { ascending: false })
    .limit(1).maybeSingle()
  if (e1) throw e1
  if (!r1) return null
  const { numero_caixa, posto } = r1 as { numero_caixa: string; posto: string }

  const { data: regs, error: e2 } = await supabase
    .from('sf_registros')
    .select('numero_serie_norm')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_caixa', numero_caixa)
  if (e2) throw e2
  const snsNorm = new Set((regs ?? []).map((x) => (x as { numero_serie_norm: string }).numero_serie_norm))

  // Fechada? Ao fechar, a embalagem reescreve o numero_caixa dos registros para o CÓDIGO final e
  // grava sf_caixas.codigo+fechada. Caixa ABERTA carrega o marcador CX[seq] (sem código em sf_caixas).
  const { data: cx, error: eCx } = await supabase
    .from('sf_caixas')
    .select('fechada')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('codigo', numero_caixa)
    .maybeSingle()
  if (eCx) throw eCx
  const fechada = (cx as { fechada: boolean } | null)?.fechada === true

  // Último registro (posto/status/rota/SN) de cada peça da caixa — pra decidir o bloqueio do NQA.
  // Uma peça cujo último registro ainda está no NQA está: REPROVADA (falta retestar) ou APROVADA
  // (caixa já finalizada). Depois do reteste, o último registro vira outro posto → LIBERA a reinspeção.
  // Pagina (PostgREST trunca em 1000): caixa grande (SNs × registros > 1000) truncaria. Ordenado desc
  // → a 1ª ocorrência de cada SN é o último registro.
  interface UltReg { numeroSerie: string; posto: string; status: string; retorno: string }
  const ultimoDaPeca = new Map<string, UltReg>()
  const PAGINA = 1000
  for (let i = 0; ; i++) {
    const { data: hist, error: e3 } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,posto,status,posto_retorno')
      .eq('pmo', pmo).eq('op', op)
      .in('numero_serie_norm', [...snsNorm])
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (e3) throw e3
    const lote = (hist ?? []) as { numero_serie: string; numero_serie_norm: string; posto: string; status: string; posto_retorno: string | null }[]
    for (const r of lote) {
      if (!ultimoDaPeca.has(r.numero_serie_norm)) {
        ultimoDaPeca.set(r.numero_serie_norm, { numeroSerie: r.numero_serie, posto: r.posto, status: r.status, retorno: r.posto_retorno ?? '' })
      }
    }
    if (lote.length < PAGINA) break
  }

  const noNqaAgora = [...ultimoDaPeca.values()].filter((u) => u.posto === postoNqa)
  // Reprovadas no NQA = ainda precisam RETESTAR (voltar pelo posto_retorno) antes de re-inspecionar.
  const pendentesRegs = noNqaAgora.filter((u) => u.status.trim().toLowerCase() === 'reprovado')
  const pendentesReteste = pendentesRegs.map((u) => u.numeroSerie)
  // Posto onde essas peças devem retestar = 1º da rota (quando único p/ todas).
  const postosDeReteste = new Set(
    pendentesRegs.map((u) => (u.retorno.split(',')[0] ?? '').trim()).filter((p) => p !== '' && p !== postoNqa),
  )
  const postoReteste = postosDeReteste.size === 1 ? [...postosDeReteste][0]! : ''
  // Finalizada = alguma peça no NQA e NENHUMA pendente de reteste (todas já inspecionadas/aprovadas).
  const jaInspecionadaNqa = noNqaAgora.length > 0 && pendentesReteste.length === 0

  return {
    posto,
    numeroCaixa: numero_caixa,
    qtd: snsNorm.size,
    snsNorm: [...snsNorm],
    fechada,
    jaInspecionadaNqa,
    pendentesReteste,
    postoReteste,
  }
}

/**
 * Estado da caixa a que um registro de embalagem pertence — só pra AVISAR o gestor, antes de
 * cancelar, que a caixa vai ser REABERTA (e a folha impressa vai precisar de reimpressão).
 * Null quando não há caixa: embalagem individual (numero_caixa = o próprio SN) ou registro antigo.
 */
export async function estadoCaixaDoRegistro(
  pmo: string, op: string, posto: string, numeroCaixa: string,
): Promise<{ seq: number; fechada: boolean } | null> {
  const alvo = numeroCaixa.trim()
  if (alvo === '') return null // codigo='' das caixas abertas casaria com tudo
  const supabase = await createServerSupabase()
  const seqMarcador = seqDoMarcadorCaixa(alvo)
  const base = supabase.from('sf_caixas').select('seq,fechada')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto)
  // Caixa aberta → o registro carrega o marcador CX[seq]; fechada → carrega o código final.
  const { data, error } = await (seqMarcador !== null ? base.eq('seq', seqMarcador) : base.eq('codigo', alvo))
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const r = data as { seq: number; fechada: boolean }
  return { seq: r.seq, fechada: r.fechada }
}
