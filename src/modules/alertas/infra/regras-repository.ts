import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ehCanal, ehJanelaTipo, ehTipoRegra, type EstadoOcorrencia } from '../domain/tipos'
import type { DestinatarioDisponivel, PreviaValida, RegraAlerta, RegraValida } from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { lerIntervaloDoBanco, type Intervalo } from '../domain/intervalos'
import { periodoOcorrencias } from '../domain/ocorrencia'
import { lerResolucao } from '../domain/resolucao'
import { codigoErroAlerta, mensagemErroAlerta } from '../domain/erros'
import type { ResultadoResolver } from '../application/portas'

const CAMPOS_REGRA =
  'id, tipo, nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, limite_tempo_seg, ' +
  'limite_ocorrencias, pausa_max_min, pmos, lembrete_min, canais, destinatarios, ' +
  'avisar_pessoas, avisar_canal, ativa, atualizado_em'

interface LinhaRegra {
  id: string
  tipo: string
  nome: string
  postos: string[] | null
  taxa_minima: number | string | null
  janela_tipo: string
  janela_valor: number | null
  minimo_bipes: number | null
  limite_tempo_seg: number | null
  limite_ocorrencias: number | null
  pausa_max_min: number | null
  pmos: string[] | null
  lembrete_min: number | null
  canais: string[] | null
  destinatarios: string[] | null
  avisar_pessoas: boolean | null
  avisar_canal: boolean | null
  ativa: boolean
  atualizado_em: string
}

/** Uma linha da tabela filha `alerta_regra_intervalos` (0139). `inicio`/`fim` são `time`. */
interface LinhaIntervalo {
  regra_id: string
  inicio: string | null
  fim: string | null
}

/** numeric do Postgres chega como string no supabase-js; null continua null. */
function numeroOuNulo(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** RLS nega em vez de esconder em algumas operações; 42501 é justamente "sem permissão". */
function erroDeBanco(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Você não tem permissão para configurar alertas.'
  return mensagemErroAlerta(error.message)
}

function paraRegra(l: LinhaRegra, intervalos: Intervalo[]): RegraAlerta {
  return {
    id: l.id,
    // Tipo desconhecido (banco mais novo que o app) cai em 'aprovacao' em vez de quebrar a lista.
    tipo: ehTipoRegra(l.tipo) ? l.tipo : 'aprovacao',
    nome: l.nome,
    postos: l.postos ?? [],
    taxaMinima: numeroOuNulo(l.taxa_minima),
    janelaTipo: ehJanelaTipo(l.janela_tipo) ? l.janela_tipo : 'tempo',
    janelaValor: l.janela_valor,
    minimoBipes: l.minimo_bipes,
    limiteTempoSeg: l.limite_tempo_seg,
    limiteOcorrencias: l.limite_ocorrencias,
    pausaMaxMin: l.pausa_max_min,
    lembreteMin: l.lembrete_min,
    // Os intervalos do turno vêm da tabela FILHA (alerta_regra_intervalos), carregada de uma vez
    // para todas as regras da lista. Janela que não é 'intervalos' não tem nenhum.
    intervalos,
    canais: (l.canais ?? []).filter(ehCanal),
    destinatarios: l.destinatarios ?? [],
    // Banco ainda sem a 0123 (deploy antes da migração): o comportamento de hoje é avisar as pessoas.
    avisarPessoas: l.avisar_pessoas ?? true,
    avisarCanal: l.avisar_canal ?? false,
    pmos: l.pmos ?? [],
    ativa: l.ativa,
    atualizadoEm: l.atualizado_em,
  }
}

/**
 * Colunas gravadas. Os campos que não são do tipo vão como null EXPLÍCITO (o check da 0115 recusa,
 * por exemplo, o default 20 de minimo_bipes numa regra de defeito). O `tipo` só vai no INSERT:
 * depois de criada, a regra não muda de tipo (trigger TIPO_FIXO da 0115).
 */
function paraLinha(r: RegraValida, comTipo: boolean): Record<string, unknown> {
  const linha: Record<string, unknown> = {
    nome: r.nome,
    postos: r.postos,
    taxa_minima: r.taxaMinima,
    janela_tipo: r.janelaTipo,
    janela_valor: r.janelaValor,
    minimo_bipes: r.minimoBipes,
    limite_tempo_seg: r.limiteTempoSeg,
    limite_ocorrencias: r.limiteOcorrencias,
    pausa_max_min: r.pausaMaxMin,
    pmos: r.pmos,
    lembrete_min: r.lembreteMin,
    canais: r.canais,
    destinatarios: r.destinatarios,
    avisar_pessoas: r.avisarPessoas,
    avisar_canal: r.avisarCanal,
    ativa: r.ativa,
  }
  if (comTipo) linha.tipo = r.tipo
  return linha
}

type ClienteSupabase = Awaited<ReturnType<typeof createServerSupabase>>

/** Mensagem das duas gravações: a regra foi salva, o turno não — e o gestor precisa saber. */
const ERRO_TURNO =
  'A regra foi salva, mas os horários do turno não. Abra a regra, confira os horários e salve de novo.'

/**
 * Os intervalos de TODAS as regras da lista em UMA consulta (`regra_id in (...)`). A listagem de
 * regras é tela de gestor: uma consulta por regra multiplicaria o round-trip pelo número de regras
 * (N+1) por um dado que cabe numa só.
 */
async function intervalosPorRegra(sb: ClienteSupabase, ids: string[]): Promise<Map<string, Intervalo[]>> {
  const mapa = new Map<string, Intervalo[]>()
  if (ids.length === 0) return mapa
  const { data, error } = await sb
    .from('alerta_regra_intervalos')
    .select('regra_id, inicio, fim')
    .in('regra_id', ids)
    .order('inicio')
  // NÃO silencia: turno vazio por engano faria a regra parar de alertar sem ninguém notar, e na
  // tela faria o gestor salvar de volta uma regra sem horário nenhum (o delete+insert da edição).
  if (error) throw new Error(`alerta_regra_intervalos: ${error.message}`)
  for (const l of (data ?? []) as LinhaIntervalo[]) {
    const intervalo = lerIntervaloDoBanco(l.inicio, l.fim)
    if (!intervalo) continue
    const lista = mapa.get(l.regra_id)
    if (lista) lista.push(intervalo)
    else mapa.set(l.regra_id, [intervalo])
  }
  return mapa
}

/**
 * Grava os intervalos do turno da regra. `apagarAntes` é a EDIÇÃO: trocar o turno é APAGAR e
 * INSERIR, nunca um upsert. Se o gestor troca 07:00–12:00 por 08:00–12:00, a linha velha tem que
 * SUMIR — senão a regra fica com DOIS intervalos e passa a medir um turno que não existe, em
 * silêncio. O mesmo delete limpa a sobra da regra que SAIU da janela 'intervalos'.
 *
 * Falha aqui NÃO vira sucesso: regra de janela 'intervalos' sem intervalo nenhum nunca tem bloco
 * fechado, então o banco a pula em toda rodada e ela não alerta mais — calada. Melhor o gestor ver
 * o erro na hora.
 */
async function trocarIntervalos(
  sb: ClienteSupabase,
  regraId: string,
  r: RegraValida,
  apagarAntes: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  if (apagarAntes) {
    const { error } = await sb.from('alerta_regra_intervalos').delete().eq('regra_id', regraId)
    if (error) {
      console.error(`[alertas] apagar os intervalos da regra ${regraId} falhou:`, error.message)
      return { ok: false, erro: ERRO_TURNO }
    }
  }
  // Regra de outra janela não tem intervalo nenhum para inserir.
  const linhas = r.janelaTipo === 'intervalos' ? r.intervalos : []
  if (linhas.length === 0) return { ok: true }
  const { error } = await sb
    .from('alerta_regra_intervalos')
    .insert(linhas.map((i) => ({ regra_id: regraId, inicio: i.inicio, fim: i.fim })))
  if (error) {
    console.error(`[alertas] gravar os intervalos da regra ${regraId} falhou:`, error.message)
    return { ok: false, erro: ERRO_TURNO }
  }
  return { ok: true }
}

export async function listarRegras(): Promise<RegraAlerta[]> {
  const sb = await createServerSupabase()
  // Regra excluída (exclusão lógica) some da lista; as ocorrências dela continuam na aba Ocorrências.
  const { data, error } = await sb
    .from('alerta_regras')
    .select(CAMPOS_REGRA)
    .is('excluida_em', null)
    .order('nome')
  if (error) throw error
  const linhas = (data ?? []) as unknown as LinhaRegra[]
  const comBlocos = linhas.filter((l) => l.janela_tipo === 'intervalos').map((l) => l.id)
  const porRegra = await intervalosPorRegra(sb, comBlocos)
  return linhas.map((l) => paraRegra(l, porRegra.get(l.id) ?? []))
}

export async function inserirRegra(r: RegraValida): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('alerta_regras').insert(paraLinha(r, true)).select('id').single()
  if (error) return { ok: false, erro: erroDeBanco(error) }
  const id = (data as { id: string }).id
  // Regra nova não tem intervalo velho para apagar.
  const turno = await trocarIntervalos(sb, id, r, false)
  if (!turno.ok) return { ok: false, erro: turno.erro }
  return { ok: true, id }
}

export async function atualizarRegra(
  id: string,
  r: RegraValida,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('alerta_regras')
    .update({ ...paraLinha(r, false), atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, erro: erroDeBanco(error) }
  // Regra que já não existe não tem o turno mexido: o update não bateu em nada.
  if ((data ?? []).length === 0) return { ok: false, erro: 'Essa regra foi excluída.' }
  const turno = await trocarIntervalos(sb, id, r, true)
  if (!turno.ok) return { ok: false, erro: turno.erro }
  return { ok: true }
}

/**
 * Exclusão LÓGICA: a regra some da lista e para de alertar, mas o histórico (ocorrências e envios)
 * continua. Não existe delete físico — a 0113 nem tem policy de DELETE, e a FK das ocorrências é
 * `restrict`. As ocorrências vivas dessa regra são encerradas SEM envio na próxima avaliação (o
 * mesmo caminho de "desativar"), que também tira o botão "Resolvido" das mensagens delas.
 */
export async function excluirRegra(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const agora = new Date().toISOString()
  const { data, error } = await sb
    .from('alerta_regras')
    .update({ excluida_em: agora, ativa: false, atualizado_em: agora })
    .eq('id', id)
    .is('excluida_em', null)
    .select('id')
  if (error) return { ok: false, erro: erroDeBanco(error) }
  if ((data ?? []).length === 0) return { ok: false, erro: 'Essa regra foi excluída.' }
  return { ok: true }
}

export async function definirRegraAtiva(
  id: string,
  ativa: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb
    .from('alerta_regras')
    .update({ ativa, atualizado_em: new Date().toISOString() })
    .eq('id', id)
    .select('id')
  if (error) return { ok: false, erro: erroDeBanco(error) }
  if ((data ?? []).length === 0) return { ok: false, erro: 'Essa regra foi excluída.' }
  return { ok: true }
}

/** Prévia por tipo (alerta_previa da 0115: parâmetros NOMEADOS — a assinatura antiga não existe mais). */
export async function previaRegra(
  p: PreviaValida,
): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_previa', {
    p_tipo: p.tipo,
    p_postos: p.postos,
    p_janela_tipo: p.janelaTipo,
    p_janela_valor: p.janelaValor,
    p_minimo: p.minimoBipes,
    p_pausa_max_min: p.pausaMaxMin,
    p_limite_ocorrencias: p.limiteOcorrencias,
    p_pmos: p.pmos,
  })
  if (error) return { ok: false, erro: mensagemErroAlerta(error.message) }
  const linhas = (data ?? []) as {
    posto: string
    defeito: string | null
    aprovados: number
    reprovados: number
    taxa: number | string | null
    media_seg: number | string | null
    intervalos: number
    pecas: number
    ocorrencias: number
    avaliavel: boolean
    pmo: string | null
    op: string | null
  }[]
  return {
    ok: true,
    postos: linhas.map((l) => ({
      posto: l.posto,
      defeito: l.defeito,
      aprovados: l.aprovados,
      reprovados: l.reprovados,
      taxa: numeroOuNulo(l.taxa),
      mediaSeg: numeroOuNulo(l.media_seg),
      intervalos: l.intervalos,
      pecas: l.pecas,
      ocorrencias: l.ocorrencias,
      avaliavel: l.avaliavel,
      pmo: l.pmo,
      op: l.op,
    })),
  }
}

/** PMOs que o formulário oferece (alerta_pmos: um text[] só, sem o teto de 1000 linhas). */
export async function listarPmosAlerta(): Promise<string[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_pmos')
  if (error) throw error
  const lista = Array.isArray(data) ? (data as unknown[]) : []
  return [...new Set(lista.map((p) => String(p ?? '').trim()).filter((p) => p !== ''))]
}

export async function listarDestinatarios(): Promise<DestinatarioDisponivel[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_destinatarios')
  if (error) throw error
  return ((data ?? []) as {
    usuario_id: string
    nome: string
    email: string
    telegram: boolean
    discord: boolean
  }[]).map((l) => ({
    usuarioId: l.usuario_id,
    nome: l.nome,
    email: l.email,
    telegram: l.telegram,
    discord: l.discord,
  }))
}

export async function listarOcorrencias(f: FiltroOcorrencias): Promise<OcorrenciaLinha[]> {
  const periodo = periodoOcorrencias(f.de, f.ate)
  if (!periodo) return []
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_listar_ocorrencias', {
    p_de: periodo.de,
    p_ate: periodo.ate,
    p_estado: f.estado,
  })
  if (error) throw error
  return ((data ?? []) as {
    id: string
    regra_id: string
    regra_nome: string
    posto: string
    pmo: string | null
    op: string | null
    estado: string
    taxa_abertura: number | string | null
    taxa_ultima: number | string | null
    aprovados: number
    reprovados: number
    aberta_em: string
    resolvida_por_nome: string | null
    resolvida_em: string | null
    normalizada_em: string | null
    envios_ok: number
    envios_falha: number
    regra_tipo: string | null
    defeito: string | null
    valor_abertura: number | string | null
    valor_ultimo: number | string | null
    amostras: number | null
    reaberta_em: string | null
    reaberturas: number | null
    explicacao: string | null
  }[]).map((l) => ({
    id: l.id,
    regraId: l.regra_id,
    regraNome: l.regra_nome,
    regraTipo: ehTipoRegra(l.regra_tipo) ? l.regra_tipo : 'aprovacao',
    posto: l.posto,
    defeito: l.defeito,
    pmo: l.pmo,
    op: l.op,
    estado: (l.estado === 'resolvida' || l.estado === 'normalizada' ? l.estado : 'aberta') as EstadoOcorrencia,
    taxaAbertura: numeroOuNulo(l.taxa_abertura),
    taxaUltima: numeroOuNulo(l.taxa_ultima),
    valorAbertura: numeroOuNulo(l.valor_abertura),
    valorUltimo: numeroOuNulo(l.valor_ultimo),
    amostras: l.amostras,
    aprovados: l.aprovados,
    reprovados: l.reprovados,
    abertaEm: l.aberta_em,
    resolvidaPorNome: l.resolvida_por_nome ?? '',
    // Banco ainda sem a 0137 (deploy antes da migração): a coluna não vem.
    explicacao: l.explicacao ?? '',
    resolvidaEm: l.resolvida_em,
    normalizadaEm: l.normalizada_em,
    reabertaEm: l.reaberta_em,
    // Banco ainda sem a 0122 (deploy antes da migração): sem reabertura nenhuma.
    reaberturas: Number(l.reaberturas ?? 0) || 0,
    enviosOk: l.envios_ok,
    enviosFalha: l.envios_falha,
  }))
}

/** Resolver pela TELA (gestor). Quem resolve pelo botão da mensagem passa por alerta_resolver. */
export async function resolverOcorrenciaComoAdmin(id: string, explicacao = ''): Promise<ResultadoResolver> {
  const sb = await createServerSupabase()
  // Sem texto o parâmetro nem vai: o default do banco ('') faz o papel (e o banco apara o resto).
  const { data, error } = await sb.rpc('alerta_resolver_admin', {
    p_ocorrencia_id: id,
    ...(explicacao ? { p_explicacao: explicacao } : {}),
  })
  if (error) {
    return { ok: false, codigo: codigoErroAlerta(error.message), erro: mensagemErroAlerta(error.message) }
  }
  return { ok: true, resolucao: lerResolucao(data) }
}
