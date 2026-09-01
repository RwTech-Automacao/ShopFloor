import 'server-only'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import type { RegistroGrade } from '../domain/grade'

export interface RegistroHistorico {
  dataHora: string
  colaborador: string
  posto: string
  pmo: string
  op: string
  status: string
  numeroCaixa: string
  numeroSerie: string
  cod: string
  pos: string
  tipo: string
  nqaVisual: string
  nqaFuncional: string
  idIntegracao: string
  reparoConserto: string
  reparoPosicao: string
}

export async function buscarRegistrosPorSn(snNorm: string): Promise<RegistroHistorico[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('data_hora,colaborador,posto,pmo,op,status,numero_caixa,numero_serie,codigo_defeito,posicao,tipo_defeito,nqa_visual,nqa_funcional,id_integracao,reparo_conserto,reparo_posicao')
    .eq('numero_serie_norm', snNorm)
    .order('data_hora', { ascending: true })
  if (error) throw error
  return (data as Record<string, string>[]).map((r) => ({
    dataHora: r.data_hora ?? '',
    colaborador: r.colaborador ?? '',
    posto: r.posto ?? '',
    pmo: r.pmo ?? '',
    op: r.op ?? '',
    status: r.status ?? '',
    numeroCaixa: r.numero_caixa ?? '',
    numeroSerie: r.numero_serie ?? '',
    cod: r.codigo_defeito ?? '',
    pos: r.posicao ?? '',
    tipo: r.tipo_defeito ?? '',
    nqaVisual: r.nqa_visual ?? '',
    nqaFuncional: r.nqa_funcional ?? '',
    idIntegracao: r.id_integracao ?? '',
    reparoConserto: r.reparo_conserto ?? '',
    reparoPosicao: r.reparo_posicao ?? '',
  }))
}

export async function listarRegistrosDaOp(pmo: string, op: string): Promise<RegistroGrade[]> {
  const supabase = await createServerSupabase()
  // PAGINADO: o PostgREST trunca em 1.000 linhas SILENCIOSAMENTE — uma OP grande
  // (SNs × postos × defeitos) passa disso fácil e a grade mentiria "Pendente".
  const PAGINA = 1000
  const out: RegistroGrade[] = []
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('sf_registros')
      .select('numero_serie_norm,posto,status,numero_caixa,data_hora')
      .eq('pmo', pmo)
      .eq('op', op)
      .order('id', { ascending: true })
      .range(de, de + PAGINA - 1)
    if (error) throw error
    const rows = data as { numero_serie_norm: string; posto: string; status: string; numero_caixa: string; data_hora: string }[]
    out.push(
      ...rows.map((r) => ({
        snNorm: r.numero_serie_norm,
        posto: r.posto,
        status: r.status,
        numeroCaixa: r.numero_caixa,
        dataHora: r.data_hora,
      })),
    )
    if (rows.length < PAGINA) break
  }
  return out
}

export interface OrdemPesquisa {
  cliente: string
  pmo: string
  op: string
  descricao: string
  sn_ini: string
  sn_fim: string
  postos: string[]
}

/** Todas as OPs (ativas E finalizadas) com fluxo ordenado — consulta é histórica. */
export async function listarTodasOrdens(): Promise<OrdemPesquisa[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_ordens')
    .select('cliente,pmo,op,descricao,sn_ini,sn_fim,sf_ordem_postos(posto,ordem)')
    .order('cliente')
    .order('pmo')
    .order('op')
  if (error) throw error
  const rows = data as unknown as {
    cliente: string
    pmo: string
    op: string
    descricao: string
    sn_ini: string
    sn_fim: string
    sf_ordem_postos: { posto: string; ordem: number }[]
  }[]
  return rows.map((r) => ({
    cliente: r.cliente,
    pmo: r.pmo,
    op: r.op,
    descricao: r.descricao,
    sn_ini: r.sn_ini,
    sn_fim: r.sn_fim,
    postos: [...r.sf_ordem_postos].sort((a, b) => a.ordem - b.ordem).map((p) => p.posto),
  }))
}

/** Uma linha da lista de Defeitos da OP (um registro reprovado com defeito). */
export interface DefeitoDaOp {
  dataHora: string
  posto: string
  sn: string
  colaborador: string
  codigo: string
  posicao: string
  tipo: string
}

/**
 * Defeitos de uma OP (linhas de sf_registros com codigo_defeito preenchido), mais recentes primeiro.
 * Paginado por `range` (offset/limite) pra lazy load — escopado à OP (índice pmo,op), volume pequeno.
 */
export async function listarDefeitosDaOp(
  pmo: string, op: string, offset: number, limite: number,
): Promise<DefeitoDaOp[]> {
  const supabase = await createServerSupabase()
  const { data, error } = await supabase
    .from('sf_registros')
    .select('data_hora,posto,numero_serie,colaborador,codigo_defeito,posicao,tipo_defeito')
    .eq('pmo', pmo)
    .eq('op', op)
    .neq('codigo_defeito', '') // só linhas COM defeito (reprova)
    .order('data_hora', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + limite - 1)
  if (error) throw error
  return (data as Record<string, string>[]).map((r) => ({
    dataHora: r.data_hora ?? '',
    posto: r.posto ?? '',
    sn: r.numero_serie ?? '',
    colaborador: r.colaborador ?? '',
    codigo: r.codigo_defeito ?? '',
    posicao: r.posicao ?? '',
    tipo: r.tipo_defeito ?? '',
  }))
}
