import { ehCanal, ehJanelaTipo, type Canal, type JanelaTipo } from './tipos'
import { textoAlerta, textoLembrete, textoNormalizou } from './mensagens'

/** Um destino concreto: a conta vinculada de um destinatário num canal. */
export interface ContaDestino {
  usuarioId: string
  canal: Canal
  externoId: string
}

export type TipoAcao = 'alerta' | 'lembrete' | 'normalizou'

/** Uma decisão tomada pelo banco, pronta para virar mensagem. */
export interface AcaoAvaliacao {
  ocorrenciaId: string
  tipo: TipoAcao
  regraId: string
  regraNome: string
  posto: string
  taxa: number
  taxaMinima: number
  aprovados: number
  reprovados: number
  janelaTipo: JanelaTipo
  janelaValor: number | null
  pmo: string | null
  op: string | null
  abertaEm: string
  agora: string
  contas: ContaDestino[]
}

export interface ResultadoAvaliacaoRpc {
  ocupado: boolean
  avaliadas: number
  acoes: AcaoAvaliacao[]
}

function lerContas(bruto: unknown): ContaDestino[] {
  if (!Array.isArray(bruto)) return []
  const contas: ContaDestino[] = []
  for (const item of bruto) {
    const c = (item ?? {}) as Record<string, unknown>
    if (!ehCanal(c.canal)) continue
    const externoId = String(c.externo_id ?? '')
    if (externoId === '') continue
    contas.push({ usuarioId: String(c.usuario_id ?? ''), canal: c.canal, externoId })
  }
  return contas
}

/**
 * Converte o jsonb do `alerta_avaliar()`. Tudo que não reconhece é DESCARTADO em vez de virar
 * exceção: um tipo de ação novo no banco (deploy fora de ordem) não pode derrubar a rota do cron.
 */
export function lerResultadoAvaliacao(json: unknown): ResultadoAvaliacaoRpc {
  const raiz = (json ?? {}) as Record<string, unknown>
  const brutas = Array.isArray(raiz.acoes) ? raiz.acoes : []
  const acoes: AcaoAvaliacao[] = []
  for (const bruta of brutas) {
    const a = (bruta ?? {}) as Record<string, unknown>
    const tipo = a.tipo
    if (tipo !== 'alerta' && tipo !== 'lembrete' && tipo !== 'normalizou') continue
    if (!ehJanelaTipo(a.janela_tipo)) continue
    acoes.push({
      ocorrenciaId: String(a.ocorrencia_id ?? ''),
      tipo,
      regraId: String(a.regra_id ?? ''),
      regraNome: String(a.regra_nome ?? ''),
      posto: String(a.posto ?? ''),
      taxa: Number(a.taxa ?? 0),
      taxaMinima: Number(a.taxa_minima ?? 0),
      aprovados: Number(a.aprovados ?? 0),
      reprovados: Number(a.reprovados ?? 0),
      janelaTipo: a.janela_tipo,
      janelaValor: a.janela_valor === null || a.janela_valor === undefined ? null : Number(a.janela_valor),
      pmo: a.pmo === null || a.pmo === undefined ? null : String(a.pmo),
      op: a.op === null || a.op === undefined ? null : String(a.op),
      abertaEm: String(a.aberta_em ?? ''),
      agora: String(a.agora ?? ''),
      contas: lerContas(a.contas),
    })
  }
  return { ocupado: raiz.ocupado === true, avaliadas: Number(raiz.avaliadas ?? 0), acoes }
}

/** Alerta e lembrete levam o botão "Resolvido"; o aviso de normalizou não tem o que resolver. */
export function acaoTemBotao(a: AcaoAvaliacao): boolean {
  return a.tipo !== 'normalizou'
}

export function textoDaAcao(a: AcaoAvaliacao): string {
  const base = {
    posto: a.posto,
    regraNome: a.regraNome,
    taxaMinima: a.taxaMinima,
    aprovados: a.aprovados,
    reprovados: a.reprovados,
    janela: { tipo: a.janelaTipo, valor: a.janelaValor, pmo: a.pmo, op: a.op },
    em: new Date(a.agora),
  }
  if (a.tipo === 'alerta') return textoAlerta(base)
  if (a.tipo === 'lembrete') return textoLembrete({ ...base, abertaEm: new Date(a.abertaEm) })
  return textoNormalizou({
    posto: a.posto,
    aprovados: a.aprovados,
    reprovados: a.reprovados,
    abertaEm: new Date(a.abertaEm),
    em: new Date(a.agora),
  })
}
