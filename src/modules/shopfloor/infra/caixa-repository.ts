import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { marcadorCaixaAberta } from '@/modules/shopfloor/domain/caixa'
import { normalizarSerie } from '@/modules/shopfloor/domain/serie'

export interface RemontagemCaixa {
  codigoAnterior: string    // código já aposentado, com o R: 'CX[7]R[14]8498-PMOC14'
  snsOriginais: string[]    // SNs da montagem reprovada (exibição), na ordem em que foram embalados
  snsOriginaisNorm: string[]
  faltando: string[]        // da montagem original, ainda não bipados na remontagem
}

export interface EstadoEmbalagem {
  seq: number            // caixa atual (aberta ou próxima a abrir)
  limite: number | null  // null = ainda não definido (operador digita)
  qtdNaCaixa: number     // peças na caixa atual
  totalEmbaladas: number // todas as peças embaladas nesta OP+posto
  snsNaCaixa: string[]   // todos os SNs da caixa atual (mais recentes primeiro)
  concluida: boolean     // última caixa já foi fechada
  remontagem: RemontagemCaixa | null // preenchido quando esta caixa está refazendo uma reprovada
  remontagensPendentes: number[]     // caixas reprovadas esperando remontagem (seq), fora esta
}

interface CaixaRow { seq: number; limite: number; fechada: boolean; ultima: boolean; revisao: number; codigo: string }

/** SNs de uma caixa (por código/marcador), sem repetir, na ordem em que foram embalados. */
async function snsDaCaixa(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  pmo: string, op: string, posto: string, chave: string,
  ordem: 'asc' | 'desc',
): Promise<{ exibicao: string[]; norm: string[] }> {
  const { data, error } = await supabase
    .from('sf_registros').select('numero_serie,numero_serie_norm')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_caixa', chave)
    .order('data_hora', { ascending: ordem === 'asc' })
  if (error) throw error
  const rows = (data ?? []) as { numero_serie: string; numero_serie_norm: string }[]
  // Uma peça pode ter mais de um registro na mesma caixa (rebipe); a caixa tem a peça UMA vez.
  const vistos = new Set<string>()
  const exibicao: string[] = []
  const norm: string[] = []
  for (const r of rows) {
    if (vistos.has(r.numero_serie_norm)) continue
    vistos.add(r.numero_serie_norm)
    exibicao.push(r.numero_serie)
    norm.push(r.numero_serie_norm)
  }
  return { exibicao, norm }
}

/**
 * Estado da caixa em que a Embalagem está trabalhando.
 *
 * `seqEmFoco` existe por causa da REMONTAGEM: quando o operador bipa uma peça que voltou de uma
 * caixa reprovada no NQA, o painel passa a trabalhar naquela caixa (que não é a da vez), e precisa
 * pedir o estado DELA. Sem o parâmetro, vale a regra normal — a caixa vigente de maior seq.
 */
export async function carregarEstadoEmbalagem(
  pmo: string, op: string, posto: string, seqEmFoco?: number,
): Promise<EstadoEmbalagem> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,limite,fechada,ultima,revisao,codigo')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).order('seq', { ascending: true })
  if (e1) throw e1
  const todas = (caixasData ?? []) as CaixaRow[]
  // revisao > 0 = montagem reprovada, congelada no histórico. A "caixa da vez" sai só das vigentes.
  const vigentes = todas.filter((c) => c.revisao === 0)
  const ultima = vigentes[vigentes.length - 1]

  const { count: total, error: eTot } = await supabase
    .from('sf_registros').select('*', { count: 'exact', head: true })
    .eq('pmo', pmo).eq('op', op).eq('posto', posto)
  if (eTot) throw eTot
  const totalEmbaladas = total ?? 0

  const foco = seqEmFoco != null ? vigentes.find((c) => c.seq === seqEmFoco && !c.fechada) : undefined

  // Caixas reprovadas ainda sem remontagem fechada. O número delas fica RESERVADO: a embalagem
  // normal não pode reutilizá-lo, senão peças novas cairiam dentro de uma remontagem pendente.
  const pendentes = todas
    .filter((c) => c.revisao > 0)
    .map((c) => c.seq)
    .filter((sq) => {
      const vig = vigentes.find((v) => v.seq === sq)
      return !vig || !vig.fechada
    })
  const reservados = new Set(pendentes)

  // concluída: a última caixa está fechada e marcada como última (uma remontagem pendente reabre o
  // trabalho — a OP não está concluída enquanto ela não fechar).
  if (!foco && reservados.size === 0 && ultima && ultima.fechada && ultima.ultima) {
    return { seq: ultima.seq, limite: ultima.limite, qtdNaCaixa: 0, totalEmbaladas, snsNaCaixa: [], concluida: true, remontagem: null, remontagensPendentes: [] }
  }

  // caixa atual: a em foco, ou a última aberta, ou a PRÓXIMA LIVRE. O próximo número sai do maior
  // seq já usado (vigente OU reprovado) + 1 — nunca de `ultima.seq + 1`: com a caixa 7 aposentada,
  // a última vigente vira a 6 e o 7 seria entregue de novo, por cima da remontagem que espera por ele.
  const maiorSeqUsado = todas.reduce((m, c) => Math.max(m, c.seq), 0)
  const abertaExiste = foco ? true : !!(ultima && !ultima.fechada)
  const seq = foco ? foco.seq : (ultima && !ultima.fechada ? ultima.seq : maiorSeqUsado + 1)

  // Montagem reprovada deste mesmo seq (a mais recente, se reprovou mais de uma vez). Fora do foco
  // isso nunca acontece — o seq da vez nunca é um reservado —, então a tela normal não é sequestrada.
  const anterior = todas
    .filter((c) => c.seq === seq && c.revisao > 0)
    .sort((a, b) => b.revisao - a.revisao)[0]

  // O limite vem da caixa em foco; na falta dela, da montagem que estamos refazendo (é a mesma
  // caixa física, mesmo limite); só então do padrão de repetir o limite da última caixa que existiu.
  const ultimaQualquer = todas.reduce<CaixaRow | undefined>((m, c) => (!m || c.seq >= m.seq ? c : m), undefined)
  const limite = foco ? foco.limite : (anterior ? anterior.limite : (ultima?.limite ?? ultimaQualquer?.limite ?? null))

  let qtdNaCaixa = 0
  let snsNaCaixa: string[] = []
  let snsAtuaisNorm: string[] = []
  if (abertaExiste) {
    const atual = await snsDaCaixa(supabase, pmo, op, posto, marcadorCaixaAberta(seq), 'desc')
    qtdNaCaixa = atual.exibicao.length
    snsNaCaixa = atual.exibicao
    snsAtuaisNorm = atual.norm
  }

  let remontagem: RemontagemCaixa | null = null
  if (anterior) {
    const orig = await snsDaCaixa(supabase, pmo, op, posto, anterior.codigo, 'asc')
    const jaNaCaixa = new Set(snsAtuaisNorm)
    remontagem = {
      codigoAnterior: anterior.codigo,
      snsOriginais: orig.exibicao,
      snsOriginaisNorm: orig.norm,
      faltando: orig.exibicao.filter((_, i) => !jaNaCaixa.has(orig.norm[i]!)),
    }
  }

  return {
    seq, limite, qtdNaCaixa, totalEmbaladas, snsNaCaixa, concluida: false, remontagem,
    remontagensPendentes: pendentes.filter((sq) => sq !== seq).sort((a, b) => a - b),
  }
}

export interface AlvoDoBipe {
  seq: number      // caixa onde a peça deve entrar
  limite: number | null // limite da caixa alvo quando é remontagem; null = usar o que veio da tela
  anterior: { codigo: string; snsOriginaisNorm: string[] } | null // montagem reprovada deste seq
}

/**
 * Onde a peça bipada deve entrar, resolvido no servidor: normalmente a caixa que está na tela, mas
 * quando ela voltou de uma montagem reprovada no NQA, a caixa DELA.
 *
 * É chamada a cada bipe, então o caminho comum tem que ser barato: a PRIMEIRA consulta já decide.
 * Se a OP/posto não tem nenhuma montagem reprovada — a esmagadora maioria —, devolve na hora, com
 * uma única leitura de `sf_caixas` (poucas linhas, servidas pelo índice de (pmo,op,posto)). As
 * outras duas consultas só acontecem quando existe caixa reprovada de verdade.
 */
export async function resolverAlvoDoBipe(
  pmo: string, op: string, posto: string, snNorm: string, seqPadrao: number,
): Promise<AlvoDoBipe> {
  const supabase = await createServerSupabase()
  const { data: caixasData, error: e1 } = await supabase
    .from('sf_caixas').select('seq,limite,fechada,ultima,revisao,codigo')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto)
  if (e1) throw e1
  const todas = (caixasData ?? []) as CaixaRow[]
  const aposentadas = todas.filter((c) => c.revisao > 0)
  if (aposentadas.length === 0) return { seq: seqPadrao, limite: null, anterior: null }

  // A peça está numa das montagens reprovadas?
  const { data: regs, error: e2 } = await supabase
    .from('sf_registros').select('numero_caixa')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_serie_norm', snNorm)
    .in('numero_caixa', aposentadas.map((c) => c.codigo))
  if (e2) throw e2
  const codigos = new Set((regs ?? []).map((r) => (r as { numero_caixa: string }).numero_caixa))

  let seq = seqPadrao
  let limite: number | null = null
  if (codigos.size > 0) {
    // Reprovada mais de uma vez → retoma a montagem mais recente. Já remontada e fechada → a peça
    // não volta pra lá; segue o fluxo normal.
    const candidatas = aposentadas
      .filter((c) => codigos.has(c.codigo))
      .sort((a, b) => (b.seq - a.seq) || (b.revisao - a.revisao))
    for (const c of candidatas) {
      const vigente = todas.find((x) => x.seq === c.seq && x.revisao === 0)
      if (!vigente || !vigente.fechada) { seq = c.seq; limite = c.limite; break }
    }
  }

  const anterior = aposentadas
    .filter((c) => c.seq === seq)
    .sort((a, b) => b.revisao - a.revisao)[0]
  if (!anterior) return { seq, limite, anterior: null }

  const { norm } = await snsDaCaixa(supabase, pmo, op, posto, anterior.codigo, 'asc')
  return { seq, limite, anterior: { codigo: anterior.codigo, snsOriginaisNorm: norm } }
}

/** Cria a linha da caixa (seq, limite) se ainda não existir. Idempotente. */
export async function garantirCaixa(pmo: string, op: string, posto: string, seq: number, limite: number): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase
    .from('sf_caixas')
    .upsert({ pmo, op, posto, seq, limite, revisao: 0 }, { onConflict: 'pmo,op,posto,seq,revisao', ignoreDuplicates: true })
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
  revisao: number  // 0 = montagem vigente; > 0 = montagem reprovada no NQA (código com R)
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
    .from('sf_caixas').select('seq,posto,limite,fechada,codigo,revisao')
    .eq('pmo', pmo).eq('op', op)
    .order('posto', { ascending: true }).order('seq', { ascending: true }).order('revisao', { ascending: false })
  if (e1) throw e1
  const caixas = (caixasData ?? []) as { seq: number; posto: string; limite: number; fechada: boolean; codigo: string; revisao: number }[]
  if (caixas.length === 0) return []

  const { data: regsData, error: e2 } = await supabase
    .from('sf_registros').select('numero_serie,numero_serie_norm,numero_caixa,posto,data_hora')
    .eq('pmo', pmo).eq('op', op).like('numero_caixa', 'CX%')
    .order('data_hora', { ascending: true })
  if (e2) throw e2
  // Agrupa por (posto, numero_caixa): o marcador/código da caixa NÃO carrega o posto, então
  // dois postos de perfil caixa poderiam ter 'CX[1]' e as peças se misturariam sem o posto na chave.
  const grupos = new Map<string, string[]>()
  const vistosPorGrupo = new Map<string, Set<string>>()
  for (const r of (regsData ?? []) as { numero_serie: string; numero_serie_norm: string; numero_caixa: string; posto: string }[]) {
    const k = `${r.posto}||${r.numero_caixa}`
    // Uma peça rebipada na mesma caixa tem 2 registros e continua sendo UMA peça na folha.
    const vistos = vistosPorGrupo.get(k) ?? new Set<string>()
    if (vistos.has(r.numero_serie_norm)) continue
    vistos.add(r.numero_serie_norm)
    vistosPorGrupo.set(k, vistos)
    const arr = grupos.get(k) ?? []
    arr.push(r.numero_serie)
    grupos.set(k, arr)
  }

  return caixas.map((c) => {
    const chave = c.revisao > 0 || c.fechada ? c.codigo : marcadorCaixaAberta(c.seq)
    const sns = grupos.get(`${c.posto}||${chave}`) ?? []
    return {
      seq: c.seq,
      posto: c.posto,
      fechada: c.fechada,
      limite: c.limite,
      codigo: c.revisao > 0 || c.fechada ? c.codigo : `CX${c.seq} (aberta)`,
      qtd: sns.length,
      sns,
      revisao: c.revisao,
    }
  })
}

export interface CaixaDoSn {
  posto: string        // posto de embalagem onde a caixa foi formada
  numeroCaixa: string  // código/marcador da caixa (numero_caixa)
  qtd: number          // total de peças (SNs distintos) da caixa
  snsNorm: string[]    // SNs (normalizados) da caixa — p/ validar que a amostra é DESTA caixa
  fechada: boolean     // a caixa já foi FECHADA na embalagem (NQA só inspeciona caixa fechada)
  aposentada: boolean  // montagem já reprovada no NQA (revisao > 0) — está sendo remontada na Embalagem
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
    .select('fechada,revisao')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('codigo', numero_caixa)
    .maybeSingle()
  if (eCx) throw eCx
  const caixaRow = cx as { fechada: boolean; revisao: number } | null
  const fechada = caixaRow?.fechada === true
  // Montagem já reprovada: continua fechada e com peças, mas não é mais inspecionável — o que vale
  // agora é a remontagem que a Embalagem vai fazer no mesmo número.
  const aposentada = (caixaRow?.revisao ?? 0) > 0

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
    aposentada,
    jaInspecionadaNqa,
    pendentesReteste,
    postoReteste,
  }
}

/**
 * Outras caixas (deste posto) em que esta peça já está. Usado só pra ESCREVER O MOTIVO do aviso
 * quando alguém inclui numa remontagem uma peça que não era da caixa original — não bloqueia nada.
 */
export async function outrasCaixasDoSn(
  pmo: string, op: string, posto: string, snNorm: string, excluir: readonly string[],
): Promise<string[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros').select('numero_caixa')
    .eq('pmo', pmo).eq('op', op).eq('posto', posto).eq('numero_serie_norm', snNorm)
    .like('numero_caixa', 'CX%')
  if (error) throw error
  const fora = new Set(excluir)
  const codigos = new Set(
    (data ?? [])
      .map((r) => (r as { numero_caixa: string }).numero_caixa)
      .filter((c) => c !== '' && !fora.has(c)),
  )
  return [...codigos]
}
