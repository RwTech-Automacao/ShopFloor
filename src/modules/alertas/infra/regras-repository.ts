import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { ehCanal, ehJanelaTipo, type EstadoOcorrencia } from '../domain/tipos'
import type { DestinatarioDisponivel, RegraAlerta, RegraValida } from '../domain/regra'
import type { FiltroOcorrencias, OcorrenciaLinha, PreviaPosto } from '../domain/ocorrencia'
import { periodoOcorrencias } from '../domain/ocorrencia'
import { lerResolucao } from '../domain/resolucao'
import { codigoErroAlerta, mensagemErroAlerta } from '../domain/erros'
import type { ResultadoResolver } from '../application/portas'

const CAMPOS_REGRA =
  'id, nome, postos, taxa_minima, janela_tipo, janela_valor, minimo_bipes, lembrete_min, canais, destinatarios, ativa, atualizado_em'

interface LinhaRegra {
  id: string
  nome: string
  postos: string[] | null
  taxa_minima: number | string
  janela_tipo: string
  janela_valor: number | null
  minimo_bipes: number
  lembrete_min: number | null
  canais: string[] | null
  destinatarios: string[] | null
  ativa: boolean
  atualizado_em: string
}

/** RLS nega em vez de esconder em algumas operações; 42501 é justamente "sem permissão". */
function erroDeBanco(error: { code?: string; message: string }): string {
  if (error.code === '42501') return 'Você não tem permissão para configurar alertas.'
  return mensagemErroAlerta(error.message)
}

function paraRegra(l: LinhaRegra): RegraAlerta {
  return {
    id: l.id,
    nome: l.nome,
    postos: l.postos ?? [],
    taxaMinima: Number(l.taxa_minima),
    janelaTipo: ehJanelaTipo(l.janela_tipo) ? l.janela_tipo : 'tempo',
    janelaValor: l.janela_valor,
    minimoBipes: l.minimo_bipes,
    lembreteMin: l.lembrete_min,
    canais: (l.canais ?? []).filter(ehCanal),
    destinatarios: l.destinatarios ?? [],
    ativa: l.ativa,
    atualizadoEm: l.atualizado_em,
  }
}

function paraLinha(r: RegraValida): Record<string, unknown> {
  return {
    nome: r.nome,
    postos: r.postos,
    taxa_minima: r.taxaMinima,
    janela_tipo: r.janelaTipo,
    janela_valor: r.janelaValor,
    minimo_bipes: r.minimoBipes,
    lembrete_min: r.lembreteMin,
    canais: r.canais,
    destinatarios: r.destinatarios,
    ativa: r.ativa,
  }
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
  return ((data ?? []) as unknown as LinhaRegra[]).map(paraRegra)
}

export async function inserirRegra(r: RegraValida): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('alerta_regras').insert(paraLinha(r)).select('id').single()
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true, id: (data as { id: string }).id }
}

export async function atualizarRegra(
  id: string,
  r: RegraValida,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { error } = await sb
    .from('alerta_regras')
    .update({ ...paraLinha(r), atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, erro: erroDeBanco(error) }
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
  const { error } = await sb
    .from('alerta_regras')
    .update({ excluida_em: agora, ativa: false, atualizado_em: agora })
    .eq('id', id)
    .is('excluida_em', null)
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true }
}

export async function definirRegraAtiva(
  id: string,
  ativa: boolean,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { error } = await sb
    .from('alerta_regras')
    .update({ ativa, atualizado_em: new Date().toISOString() })
    .eq('id', id)
  if (error) return { ok: false, erro: erroDeBanco(error) }
  return { ok: true }
}

export async function previaRegra(p: {
  postos: string[]
  janelaTipo: string
  janelaValor: number | null
  minimoBipes: number
}): Promise<{ ok: true; postos: PreviaPosto[] } | { ok: false; erro: string }> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_previa', {
    p_postos: p.postos,
    p_janela_tipo: p.janelaTipo,
    p_janela_valor: p.janelaValor,
    p_minimo: p.minimoBipes,
  })
  if (error) return { ok: false, erro: mensagemErroAlerta(error.message) }
  const linhas = (data ?? []) as {
    posto: string
    aprovados: number
    reprovados: number
    taxa: number | string | null
    avaliavel: boolean
    pmo: string | null
    op: string | null
  }[]
  return {
    ok: true,
    postos: linhas.map((l) => ({
      posto: l.posto,
      aprovados: l.aprovados,
      reprovados: l.reprovados,
      taxa: l.taxa === null ? null : Number(l.taxa),
      avaliavel: l.avaliavel,
      pmo: l.pmo,
      op: l.op,
    })),
  }
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
    taxa_abertura: number | string
    taxa_ultima: number | string
    aprovados: number
    reprovados: number
    aberta_em: string
    resolvida_por_nome: string | null
    resolvida_em: string | null
    normalizada_em: string | null
    envios_ok: number
    envios_falha: number
  }[]).map((l) => ({
    id: l.id,
    regraId: l.regra_id,
    regraNome: l.regra_nome,
    posto: l.posto,
    pmo: l.pmo,
    op: l.op,
    estado: (l.estado === 'resolvida' || l.estado === 'normalizada' ? l.estado : 'aberta') as EstadoOcorrencia,
    taxaAbertura: Number(l.taxa_abertura),
    taxaUltima: Number(l.taxa_ultima),
    aprovados: l.aprovados,
    reprovados: l.reprovados,
    abertaEm: l.aberta_em,
    resolvidaPorNome: l.resolvida_por_nome ?? '',
    resolvidaEm: l.resolvida_em,
    normalizadaEm: l.normalizada_em,
    enviosOk: l.envios_ok,
    enviosFalha: l.envios_falha,
  }))
}

/** Resolver pela TELA (gestor). Quem resolve pelo botão da mensagem passa por alerta_resolver. */
export async function resolverOcorrenciaComoAdmin(id: string): Promise<ResultadoResolver> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.rpc('alerta_resolver_admin', { p_ocorrencia_id: id })
  if (error) {
    return { ok: false, codigo: codigoErroAlerta(error.message), erro: mensagemErroAlerta(error.message) }
  }
  return { ok: true, resolucao: lerResolucao(data) }
}
