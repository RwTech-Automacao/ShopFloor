import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { mapaPostoPerfil } from './postos-repository'
import { numerarPassagens, postoPendenteDePeca, MANUTENCAO, type FluxoAgregado, type PassagemPosto, type RegistroPassagem, type BipePeca } from '../domain/fluxo-op'
import { pareaBurnin, estaAberto, type RegistroBurnin } from '../domain/burnin'
import { snsNaoIniciados } from '../domain/grade'

export interface OpItem { pmo: string; op: string; cliente: string; descricao: string }
export interface SnDoPosto { sn: string; status: string; vezes: number }
export interface DetalhePosto { agora: SnDoPosto[]; historico: PassagemPosto[] }
/** Peça com Burn-in em andamento: SN + hora de entrada (ISO) do ciclo aberto. */
export interface BurninEmAndamento { sn: string; desde: string }
/** Detalhe do nó Burn-in: cozinhando agora (ciclo aberto) + eventos de entrada e de saída. */
export interface BurninDetalhe {
  emAndamento: BurninEmAndamento[]
  entradas: { sn: string; dataHora: string }[]
  saidas: { sn: string; dataHora: string; status: string }[]
}
/** Peça embalada + a caixa em que está (nó Embalagem). */
export interface EmbalagemCaixa { sn: string; caixa: string }

/** Todas as OPs (pra escolher no seletor do Fluxo). */
export async function listarOrdens(): Promise<OpItem[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('pmo,op,cliente,descricao')
    .order('pmo')
    .order('op')
  if (error) throw error
  return (data ?? []) as OpItem[]
}

/** Postos ordenados do fluxo + agregados (RPC) + mapa temStatus/recurso por posto + qtd da OP. */
export async function carregarFluxoOp(
  pmo: string,
  op: string,
): Promise<{
  postos: string[]
  agregados: FluxoAgregado[]
  temStatus: Record<string, boolean>
  recurso: Record<string, string>
  exigeManutencao: Record<string, boolean>
  qtd: number | null
  naoIniciadas: number | null
  finalizadas: number | null
}> {
  const supabase = await createServerSupabase()

  const { data: ordem, error: e1 } = await supabase
    .from('sf_ordens')
    .select('qtd,sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo)
    .eq('op', op)
    .maybeSingle()
  if (e1) throw e1
  const lista = ((ordem?.sf_ordem_postos ?? []) as { posto: string; ordem: number }[])
  const postos = [...lista].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto)
  const qtd = (ordem?.qtd ?? null) as number | null

  const { data: agg, error: e2 } = await supabase.rpc('sf_fluxo_op', { p_pmo: pmo, p_op: op })
  if (e2) throw e2
  // A RPC devolve as colunas em snake_case (aprovados_primeira/reprovados_sem_reteste) → mapeadas pra camelCase abaixo.
  type AggRpc = { posto: string; wip: number; registros: number; aprovadas: number; reprovadas: number; retestes: number; aprovados_primeira: number; reprovados_sem_reteste: number }
  const agregados = (agg ?? []) as AggRpc[]

  const perfis = await mapaPostoPerfil()
  const temStatus: Record<string, boolean> = {}
  const recurso: Record<string, string> = {}
  const exigeManutencao: Record<string, boolean> = {}
  for (const p of postos) {
    temStatus[p] = perfis[p]?.temStatus ?? false
    recurso[p] = perfis[p]?.recurso ?? 'nenhum'
    exigeManutencao[p] = perfis[p]?.exigeManutencao ?? false
  }

  // WIP de cada nó = "pendentes no posto" (a fila): peça aprovada avança pro próximo posto.
  const { pendentes, iniciadas, finalizadas } = await contarPendentesPorPosto(
    pmo,
    op,
    postos,
    (p) => exigeManutencao[p] ?? false,
    (p) => recurso[p] ?? 'nenhum',
  )
  // Caixa de Entrada = peças que ainda não começaram (qtd − peças com algum registro). Só se a OP tem qtd.
  const naoIniciadas = qtd != null ? Math.max(0, qtd - iniciadas) : null
  // As não iniciadas também AGUARDAM no 1º posto → entram na fila (pendentes) dele.
  if (naoIniciadas && postos[0]) {
    const k = postos[0].toLowerCase()
    pendentes[k] = (pendentes[k] ?? 0) + naoIniciadas
  }

  const agregadosComPendentes: FluxoAgregado[] = [...postos, MANUTENCAO].map((posto) => {
    const a = agregados.find((x) => x.posto.toLowerCase() === posto.toLowerCase())
    return {
      posto,
      wip: pendentes[posto.toLowerCase()] ?? 0, // override: a fila (era último-bipe-aqui, da RPC)
      registros: a?.registros ?? 0,
      aprovadas: a?.aprovadas ?? 0,
      reprovadas: a?.reprovadas ?? 0,
      retestes: a?.retestes ?? 0,
      aprovadosPrimeira: a?.aprovados_primeira ?? 0,
      reprovadosSemReteste: a?.reprovados_sem_reteste ?? 0,
    }
  })

  return { postos, agregados: agregadosComPendentes, temStatus, recurso, exigeManutencao, qtd, naoIniciadas, finalizadas }
}

/** Mediana do tempo (segundos) entre postos consecutivos (RPC sf_fluxo_tempos). Chave `origem||destino`.
 *  Acessório: se a RPC falhar, devolve {} e o fluxo carrega sem os rótulos de tempo. */
export async function carregarTemposFluxo(pmo: string, op: string): Promise<Record<string, number>> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase.rpc('sf_fluxo_tempos', { p_pmo: pmo, p_op: op })
  if (error) return {}
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { origem: string; destino: string; segundos: number }[]) {
    out[`${r.origem}||${r.destino}`] = r.segundos
  }
  return out
}

/**
 * Conta as peças pendentes (aguardando) em cada posto da OP — a "fila" (chave = posto minúsculo) —
 * mais `iniciadas` (peças com ≥1 registro) e `finalizadas` (concluíram todo o fluxo).
 */
async function contarPendentesPorPosto(
  pmo: string,
  op: string,
  postos: string[],
  exige: (p: string) => boolean,
  recurso: (p: string) => string,
): Promise<{ pendentes: Record<string, number>; iniciadas: number; finalizadas: number }> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; posto: string; posto_retorno: string | null; data_hora: string; id: number }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,posto,posto_retorno,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: true })
      .order('id', { ascending: true })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  const porPeca = new Map<string, BipePeca[]>()
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    const e = porPeca.get(chave)
    if (e) e.push({ posto: l.posto, status: l.status })
    else porPeca.set(chave, [{ posto: l.posto, status: l.status }])
  }
  const cont: Record<string, number> = {}
  let finalizadas = 0
  for (const regs of porPeca.values()) {
    const pend = postoPendenteDePeca(regs, postos, exige, recurso)
    if (pend) cont[pend.toLowerCase()] = (cont[pend.toLowerCase()] ?? 0) + 1
    else finalizadas += 1 // pend === null → peça concluiu todo o fluxo
  }
  // iniciadas = peças com ≥1 registro (as sem registro nenhum nem aparecem em sf_registros).
  return { pendentes: cont, iniciadas: porPeca.size, finalizadas }
}

/**
 * Detalhe de um posto (lazy, ao abrir o nó). Um único scan da OP devolve:
 *  - `agora`: peças PENDENTES no posto (a fila — aguardando ser processadas aqui; ver
 *     postoPendenteDePeca: aprovada avança pro próximo posto, reprovada vai pra Manutenção etc.);
 *  - `historico`: todas as passagens da peça pelo posto, numeradas (1x/2x…).
 */
export async function carregarDetalhePosto(pmo: string, op: string, posto: string): Promise<DetalhePosto> {
  const supabase = await createServerSupabase()
  // ordem dos postos + flags do perfil (pra decidir a fila de cada peça)
  const { data: ordemRow, error: eo } = await supabase
    .from('sf_ordens')
    .select('sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .eq('pmo', pmo)
    .eq('op', op)
    .maybeSingle()
  if (eo) throw eo
  const postos = [...((ordemRow?.sf_ordem_postos ?? []) as { posto: string; ordem: number }[])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => p.posto)
  const perfis = await mapaPostoPerfil()
  const exige = (p: string) => perfis[p]?.exigeManutencao ?? false
  const recursoDe = (p: string) => perfis[p]?.recurso ?? 'nenhum'

  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; posto: string; posto_retorno: string | null; data_hora: string; id: number }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,posto,posto_retorno,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: true })
      .order('id', { ascending: true }) // cronológico: o último da peça = bipe mais recente
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  const alvo = posto.toLowerCase()
  const porPeca = new Map<string, { sn: string; regs: BipePeca[] }>()
  const passagens: RegistroPassagem[] = [] // cada bipe da peça NO posto (pra numerar 1x/2x…)
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    const e = porPeca.get(chave)
    const reg = { posto: l.posto, status: l.status, postoRetorno: l.posto_retorno ?? undefined }
    if (e) e.regs.push(reg)
    else porPeca.set(chave, { sn: l.numero_serie, regs: [reg] })
    if (l.posto.toLowerCase() === alvo) {
      passagens.push({ chave, sn: l.numero_serie, status: l.status, dataHora: l.data_hora, ordem: l.id })
    }
  }
  const agora: SnDoPosto[] = []
  for (const { sn, regs } of porPeca.values()) {
    const pend = postoPendenteDePeca(regs, postos, exige, recursoDe)
    if (pend && pend.toLowerCase() === alvo) agora.push({ sn, status: '', vezes: 1 }) // pendente: sem resultado aqui ainda
  }

  // No 1º posto, as peças NÃO INICIADAS (SNs da faixa que ainda não têm registro) também aguardam
  // aqui — antes só apareciam no contador/nota, agora entram na lista (com teto p/ OP grande).
  const faixa = ordemRow as unknown as { sn_ini: string | null; sn_fim: string | null } | null
  if (postos[0] && alvo === postos[0].toLowerCase() && faixa?.sn_ini && faixa?.sn_fim) {
    const naoIniciados = snsNaoIniciados(faixa.sn_ini, faixa.sn_fim, new Set(porPeca.keys()), 500)
    if (naoIniciados) {
      for (const sn of naoIniciados) agora.push({ sn, status: 'não iniciada', vezes: 1 })
    }
  }

  return {
    agora: agora.sort((a, b) => a.sn.localeCompare(b.sn)),
    historico: numerarPassagens(passagens),
  }
}

/**
 * SNs que estão em Manutenção AGORA = peças cujo ÚLTIMO bipe (em qualquer posto) foi reprovado
 * — mesma regra do WIP de Manutenção na RPC. O `status` traz o posto onde reprovou (onde a peça travou).
 * (Difere de carregarSnsDoPosto('Manutenção'), que traria só registros de reparo.)
 */
export async function carregarSnsEmManutencao(pmo: string, op: string): Promise<SnDoPosto[]> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; posto: string; data_hora: string; id: number }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,posto,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  // linhas desc por (data_hora,id): a PRIMEIRA de cada SN é o último bipe. Em Manutenção = último bipe
  // reprovado NUM POSTO QUE EXIGE MANUTENÇÃO (reprova de posto com conserto no lugar fica no próprio
  // posto, coerente com postoPendenteDePeca e com o WIP do nó).
  const perfis = await mapaPostoPerfil()
  const visto = new Set<string>()
  const res: SnDoPosto[] = []
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    if (visto.has(chave)) continue
    visto.add(chave)
    if (l.status.toLowerCase() === 'reprovado' && (perfis[l.posto]?.exigeManutencao ?? false)) {
      res.push({ sn: l.numero_serie, status: `Reprovado · ${l.posto}`, vezes: 1 })
    }
  }
  return res.sort((a, b) => a.sn.localeCompare(b.sn))
}

/**
 * Detalhe do nó Burn-in: separa ENTRADA e SAÍDA (o Burn-in tem os dois eventos por peça — antes
 * eram contados como passagens 1x/2x) e lista as peças com ciclo ABERTO (cozinhando) + a hora de
 * entrada. Entradas/saídas: mais recente primeiro; cozinhando: entrada mais antiga (mais tempo) primeiro.
 */
export async function carregarBurninDetalhe(pmo: string, op: string, posto: string): Promise<BurninDetalhe> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; status: string; data_hora: string }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,status,data_hora')
      .eq('pmo', pmo)
      .eq('op', op)
      .eq('posto', posto)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: true })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  const entradas: { sn: string; dataHora: string }[] = []
  const saidas: { sn: string; dataHora: string; status: string }[] = []
  const porPeca = new Map<string, { sn: string; regs: RegistroBurnin[] }>()
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    if (l.status.trim() === '') entradas.push({ sn: l.numero_serie, dataHora: l.data_hora })
    else saidas.push({ sn: l.numero_serie, dataHora: l.data_hora, status: l.status })
    const e = porPeca.get(chave)
    if (e) e.regs.push({ dataHora: l.data_hora, status: l.status })
    else porPeca.set(chave, { sn: l.numero_serie, regs: [{ dataHora: l.data_hora, status: l.status }] })
  }
  const emAndamento: BurninEmAndamento[] = []
  for (const { sn, regs } of porPeca.values()) {
    const ciclos = pareaBurnin(regs)
    const ultimo = ciclos[ciclos.length - 1]
    if (estaAberto(ciclos) && ultimo) emAndamento.push({ sn, desde: ultimo.entrada })
  }
  return {
    emAndamento: emAndamento.sort((a, b) => a.desde.localeCompare(b.desde)),
    entradas: entradas.sort((a, b) => b.dataHora.localeCompare(a.dataHora)),
    saidas: saidas.sort((a, b) => b.dataHora.localeCompare(a.dataHora)),
  }
}

/** Peça embalada + a caixa em que está (registro mais recente por SN; recente primeiro). Nó Embalagem. */
export async function carregarEmbalagemCaixas(pmo: string, op: string, posto: string): Promise<EmbalagemCaixa[]> {
  const supabase = await createServerSupabase()
  const PAGINA = 1000
  const linhas: { numero_serie: string; numero_serie_norm: string; numero_caixa: string; data_hora: string; id: number }[] = []
  for (let i = 0; ; i++) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie,numero_serie_norm,numero_caixa,data_hora,id')
      .eq('pmo', pmo)
      .eq('op', op)
      .eq('posto', posto)
      .neq('numero_serie_norm', '')
      .order('data_hora', { ascending: false })
      .order('id', { ascending: false })
      .range(i * PAGINA, i * PAGINA + PAGINA - 1)
    if (error) throw error
    const lote = (data ?? []) as typeof linhas
    linhas.push(...lote)
    if (lote.length < PAGINA) break
  }
  const visto = new Set<string>()
  const res: EmbalagemCaixa[] = []
  for (const l of linhas) {
    const chave = l.numero_serie_norm || l.numero_serie
    if (visto.has(chave)) continue // 1ª (mais recente) = a caixa atual
    visto.add(chave)
    res.push({ sn: l.numero_serie, caixa: l.numero_caixa || '—' })
  }
  return res
}
