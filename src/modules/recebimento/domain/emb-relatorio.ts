/**
 * O relatório de UMA EMB (/recebimento/emb/<emb>), aberto pelo link da mensagem do alerta "Fim de EMB" ou pelo
 * item "Relatório de EMB" do menu (o índice /recebimento/emb escolhe a EMB).
 * O banco devolve tudo pronto em `rec_emb_relatorio` (0178), com as divergências da MESMA
 * `rec_emb_divergencias` que o alerta usa; aqui só se lê o jsonb.
 */
export interface DivergenciaDaEmb {
  /** O id do processo (para o link do detalhe). Null se o processo não foi achado pelo número. */
  id: string | null
  numero: number
  item: string
  descricao: string
  quantidadePedido: number | null
  quantidadeRecebida: number | null
  /** Como o banco guarda (texto): '-10', '5'. */
  divergencia: string
  /** Vazia = ninguém justificou (a que precisa de ação). */
  justificativa: string
  justificadaPorNome: string
  justificadaEm: Date | null
  /** Nº da PO do processo ('' = sem PO). A RPC não traz: o repositório completa pelo id do processo. */
  pedido: string
}

export interface RelatorioEmb {
  emb: string
  /** Processos não cancelados da EMB. */
  processos: number
  /** Os Nº da PO distintos. */
  pedidos: string[]
  fechada: boolean
  fechadaEm: Date | null
  divergencias: DivergenciaDaEmb[]
}

export type LeituraRelatorioEmb =
  | { ok: true; valor: RelatorioEmb }
  | { ok: false; motivo: 'emb_inexistente' | 'resposta_ilegivel' }

const texto = (v: unknown) => (typeof v === 'string' ? v : '')

function numeroOuNulo(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function dataOuNula(v: unknown): Date | null {
  if (typeof v !== 'string' || v === '') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

export function lerRelatorioEmb(bruto: unknown): LeituraRelatorioEmb {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return { ok: false, motivo: 'resposta_ilegivel' }
  const r = bruto as Record<string, unknown>
  if (r.ok !== true) return { ok: false, motivo: r.motivo === 'emb_inexistente' ? 'emb_inexistente' : 'resposta_ilegivel' }
  if (typeof r.emb !== 'string' || !Array.isArray(r.divergencias)) return { ok: false, motivo: 'resposta_ilegivel' }
  const divergencias: DivergenciaDaEmb[] = []
  for (const item of r.divergencias) {
    if (item === null || typeof item !== 'object') continue
    const d = item as Record<string, unknown>
    const numero = numeroOuNulo(d.numero)
    if (numero === null) continue
    divergencias.push({
      id: typeof d.id === 'string' && d.id !== '' ? d.id : null,
      numero,
      item: texto(d.item),
      descricao: texto(d.descricao),
      quantidadePedido: numeroOuNulo(d.quantidade_pedido),
      quantidadeRecebida: numeroOuNulo(d.quantidade_recebida),
      divergencia: texto(d.divergencia),
      justificativa: texto(d.justificativa),
      justificadaPorNome: texto(d.justificada_por_nome),
      justificadaEm: dataOuNula(d.justificada_em),
      pedido: texto(d.pedido).trim(),
    })
  }
  return {
    ok: true,
    valor: {
      emb: r.emb,
      processos: numeroOuNulo(r.processos) ?? 0,
      pedidos: Array.isArray(r.pedidos) ? r.pedidos.filter((p): p is string => typeof p === 'string' && p !== '') : [],
      fechada: r.fechada === true,
      fechadaEm: dataOuNula(r.fechada_em),
      divergencias,
    },
  }
}

/** Quantas divergências ninguém justificou ainda. */
export function semJustificativa(divergencias: readonly DivergenciaDaEmb[]): number {
  return divergencias.filter((d) => d.justificativa.trim() === '').length
}

/** O caminho do relatório de uma EMB (a EMB vai codificada: pode ter espaço ou barra). */
export function caminhoRelatorioEmb(emb: string): string {
  return `/recebimento/emb/${encodeURIComponent(emb.trim())}`
}

/** As EMBs que contêm o filtro (sem diferenciar maiúsculas), na ordem recebida. Filtro vazio: todas. */
export function filtrarEmbs(embs: readonly string[], filtro: string): readonly string[] {
  const f = filtro.trim().toLowerCase()
  return f ? embs.filter((e) => e.toLowerCase().includes(f)) : embs
}
