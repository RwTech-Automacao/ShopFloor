/**
 * Baixa de NF de SAÍDA emitida sem saldo (spec 2026-11-16-baixa-nf-compels-design.md, com a fila de prioridade
 * de 2026-11-17-faturamento-baixa-nf-design.md: sem data de corte, só baixa o que alguém selecionou).
 *
 * Puro: recebe o que a tela "Baixa de Mercadoria" do Compels lê (a nota da lista `notaICMS/findFilterStockMoves`
 * e as linhas de `itemBaixaMercadoria/findAll*ByNotaICMSId`) e decide o que fazer com a nota. O corpo do
 * `baixaMercadoria/baixar` copia o `baixar` do JS da tela (classic/app.js, 16/11/2026), campo a campo.
 */

export const ESTOQUE_PA = 'PA'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {})
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const txt = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Uma nota da lista de pendentes, só com o que a automação usa. */
export interface NotaPendente {
  id: number
  numero: number
  empresaId: number
  /** `aaaa-mm-dd` da emissão. */
  emissao: string
  codigoRemetente: unknown
  razaoSocialNomeRemetente: unknown
  /** Texto livre da nota (onde às vezes vai o número de série). Só informativo. */
  informacoesComplementares: string
  // ---- só para a tela (Faturamento) ----
  clienteCodigo: string
  clienteNome: string
  /** `totalNota`; `null` quando não veio número. */
  valor: number | null
  /** Tirado de `observacoesFinanceiro` ("…Pedido de Venda 2836/26"); vazio se não houver. */
  pedidoVenda: string
  /** Natureza da operação (texto, ou a descrição do objeto). */
  natureza: string
}

/** "…Pedido de Venda 2836/26…" → `2836/26`. Sem o padrão → `''`. */
export function pedidoDeVenda(texto: string): string {
  return /pedido\s+de\s+venda\s*(?:n[º°o.]*\s*)?(\d+(?:\/\d+)?)/i.exec(texto)?.[1] ?? ''
}

const textoOuDescricao = (v: unknown): string =>
  (typeof v === 'string' ? v : txt(obj(v).descricao) || txt(obj(v).nome)).trim()

/** Lê uma nota da lista. `null` = a linha não tem o mínimo (id, número, empresa, emissão). */
export function lerNota(v: unknown): NotaPendente | null {
  const n = obj(v)
  const id = num(n.id)
  const numero = num(n.numero)
  const empresaId = num(obj(n.empresa).id)
  const emissao = txt(n.dataHoraEmissao).slice(0, 10)
  if (id == null || numero == null || empresaId == null || !/^\d{4}-\d{2}-\d{2}$/.test(emissao)) return null
  return {
    id, numero, empresaId, emissao,
    codigoRemetente: n.codigoRemetente ?? null,
    razaoSocialNomeRemetente: n.razaoSocialNomeRemetente ?? null,
    informacoesComplementares: txt(n.informacoesComplementares),
    clienteCodigo: String(n.codigoRemetente ?? '').trim(),
    clienteNome: txt(n.razaoSocialNomeRemetente).trim(),
    valor: num(n.totalNota),
    pedidoVenda: pedidoDeVenda(txt(n.observacoesFinanceiro)),
    natureza: textoOuDescricao(n.naturezaOperacao),
  }
}

/** Da mais antiga para a mais nova; empate pelo número da nota. */
export function ordenarPorEmissao(notas: NotaPendente[]): NotaPendente[] {
  return [...notas].sort((a, b) => a.emissao.localeCompare(b.emissao) || a.numero - b.numero)
}

export type MotivoEspera = 'sem_saldo_pa' | 'quantidade_incompleta'
export type MotivoManual = 'rastreavel' | 'linhas_em_terceiros' | 'sem_itens'

export type DecisaoNota =
  | { acao: 'esperar'; motivo: MotivoEspera }
  | { acao: 'manual'; motivo: MotivoManual }
  | { acao: 'baixar'; corpo: Obj; itens: { codigo: string; quantidade: number }[] }

export const TEXTO_MOTIVO: Record<MotivoEspera | MotivoManual, string> = {
  sem_saldo_pa: 'ainda sem saldo no estoque PA',
  quantidade_incompleta: 'o saldo encontrado não cobre a quantidade da nota',
  rastreavel: 'item com controle de número de série no Compels — baixar à mão',
  linhas_em_terceiros: 'nota com itens em estoque de terceiros — baixar à mão',
  sem_itens: 'o Compels não devolveu nenhum item de estoque próprio — conferir à mão',
}

/** Código do produto da linha (para o desconto no Fluxo e para o log). */
export function codigoDaLinha(linha: unknown): string {
  const l = obj(linha)
  return (
    txt(obj(obj(l.itemLote).item).codigo) ||
    txt(obj(obj(l.itemNotaICMS).item).codigo) ||
    txt(obj(l.itemNotaICMS).numeroItemPedidoVenda)
  ).trim()
}

/** Corpo de UMA linha de estoque próprio, como o `baixar` da tela (sem números de série). */
function corpoDaLinha(l: Obj, empresaId: number): Obj {
  const it = obj(l.itemNotaICMS)
  const lote = obj(l.itemLote)
  const item = obj(lote.item)
  const ile = obj(lote.itemLoteEstoque)
  const est = obj(ile.estoque)
  const loc = obj(ile.itemLoteEstoqueLocacao)
  const pv = l.itemPedidoVendaItemLote == null ? null : obj(l.itemPedidoVendaItemLote)
  return {
    itemNotaICMS: {
      id: it.id, empresa: { id: empresaId }, quantidadeInterna: it.quantidadeInterna,
      observacoesAceiteBaixa: it.observacoesAceiteBaixa,
    },
    itemLote: {
      id: lote.id,
      item: { id: item.id, rastreavel: item.rastreavel },
      numeroLoteFabricacao: lote.numeroLoteFabricacao, dataFabricacao: lote.dataFabricacao, dataValidade: lote.dataValidade,
      itemLoteEstoque: {
        id: ile.id, tipoPropriedadeEstoque: ile.tipoPropriedadeEstoque, negociante: { id: obj(ile.negociante).id },
        estoque: { id: est.id, codigo: est.codigo },
        itemLoteEstoqueLocacao: { id: loc.id, saldo: loc.saldo },
      },
    },
    itemPedidoVendaItemLote: { id: pv ? pv.id : '', quantidade: pv ? pv.quantidade : '' },
    itemLoteNumeroSerieList: [],
    itemLoteNumeroSerieListPendencia: [],
    quantidade: l.quantidade,
    unidade: l.unidade,
    baixaEmTerceiros: l.baixaEmTerceiros,
  }
}

export interface EntradaAvaliacao {
  nota: NotaPendente
  /** Linhas de `findAllEstoqueProprioByNotaICMSId`. */
  proprias: unknown[]
  emTerceiros: unknown[]
  deTerceiros: unknown[]
  /** Vai no `usuarioAceiteBaixa` e na observação da baixa. */
  usuario: string
}

/** Decide o que fazer com UMA nota pendente. Nunca baixa parcial. */
export function avaliarNota(e: EntradaAvaliacao): DecisaoNota {
  if (e.emTerceiros.length > 0 || e.deTerceiros.length > 0) return { acao: 'manual', motivo: 'linhas_em_terceiros' }
  if (e.proprias.length === 0) return { acao: 'manual', motivo: 'sem_itens' }

  const linhas = e.proprias.map(obj)
  if (linhas.some((l) => obj(obj(l.itemLote).item).rastreavel === true)) return { acao: 'manual', motivo: 'rastreavel' }

  const pedidoPorItem = new Map<number, number>()
  const baixaPorItem = new Map<number, number>()
  const usoPorLocacao = new Map<number, { usado: number; saldo: number }>()
  for (const l of linhas) {
    const it = obj(l.itemNotaICMS)
    const idItem = num(it.id)
    const pedido = num(it.quantidadeInterna)
    const qtd = num(l.quantidade) ?? 0
    const lote = obj(l.itemLote)
    const ile = obj(lote.itemLoteEstoque)
    const loc = obj(ile.itemLoteEstoqueLocacao)
    const idLoc = num(loc.id)
    if (idItem == null || pedido == null) return { acao: 'esperar', motivo: 'quantidade_incompleta' }
    if (num(lote.id) == null || idLoc == null || txt(obj(ile.estoque).codigo) !== ESTOQUE_PA || qtd <= 0) {
      return { acao: 'esperar', motivo: 'sem_saldo_pa' }
    }
    pedidoPorItem.set(idItem, pedido)
    baixaPorItem.set(idItem, (baixaPorItem.get(idItem) ?? 0) + qtd)
    const u = usoPorLocacao.get(idLoc) ?? { usado: 0, saldo: num(loc.saldo) ?? 0 }
    u.usado += qtd
    usoPorLocacao.set(idLoc, u)
  }
  for (const [idItem, pedido] of pedidoPorItem) {
    if (Math.abs((baixaPorItem.get(idItem) ?? 0) - pedido) > 1e-9) return { acao: 'esperar', motivo: 'quantidade_incompleta' }
  }
  for (const u of usoPorLocacao.values()) if (u.usado > u.saldo + 1e-9) return { acao: 'esperar', motivo: 'sem_saldo_pa' }

  const n = e.nota
  const corpo: Obj = {
    notaICMS: {
      numero: n.numero, empresa: { id: n.empresaId }, id: n.id,
      codigoRemetente: n.codigoRemetente, razaoSocialNomeRemetente: n.razaoSocialNomeRemetente,
      observacoesBaixaMercadoria: `Baixa automática pelo ShopFloor (${e.usuario}).`,
      usuarioAceiteBaixa: e.usuario,
    },
    itemNotaICMSItemLoteEstoqueProprioList: linhas.map((l) => corpoDaLinha(l, n.empresaId)),
    itemNotaICMSItemLoteEstoqueEmTerceirosList: [],
    itemNotaICMSItemLoteEstoqueDeTerceirosList: [],
  }
  const itens = new Map<string, number>()
  for (const l of linhas) itens.set(codigoDaLinha(l), (itens.get(codigoDaLinha(l)) ?? 0) + (num(l.quantidade) ?? 0))
  return { acao: 'baixar', corpo, itens: [...itens].map(([codigo, quantidade]) => ({ codigo, quantidade })) }
}

// ---- Tela do Faturamento: o que mostrar de cada nota e o que vai acontecer ao confirmar ----

/** Um item da nota como a tela mostra: código, descrição e a quantidade da nota. */
export interface ItemDaNota {
  codigo: string
  descricao: string
  quantidade: number
}

/**
 * Um por item da nota (`itemNotaICMS.id`), na ordem em que aparecem. Um item com vários lotes propostos vem em
 * várias linhas com a MESMA `quantidadeInterna` — conta uma vez só.
 */
export function itensDaNota(proprias: unknown[]): ItemDaNota[] {
  const porItem = new Map<unknown, ItemDaNota>()
  for (const linha of proprias) {
    const l = obj(linha)
    const it = obj(l.itemNotaICMS)
    const chave = it.id ?? porItem.size
    if (porItem.has(chave)) continue
    porItem.set(chave, {
      codigo: codigoDaLinha(l),
      descricao: (txt(it.descricao) || txt(obj(it.item).descricao) || txt(obj(obj(l.itemLote).item).descricao)).trim(),
      quantidade: num(it.quantidadeInterna) ?? 0,
    })
  }
  return [...porItem.values()]
}

/** Quantidade da nota por código (dois itens com o mesmo código somam). */
function quantidadePorCodigo(itens: ItemDaNota[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const i of itens) m.set(i.codigo, (m.get(i.codigo) ?? 0) + i.quantidade)
  return m
}

export type SituacaoNota =
  | { tipo: 'pode_baixar' }
  | { tipo: 'sem_saldo'; motivo: string; faltas: { codigo: string; falta: number }[] }
  | { tipo: 'manual'; motivo: string }

/**
 * A situação que a tela mostra. Quem decide é o `avaliarNota` (lotes que o Compels propõe); o estoque do PA por
 * código (`null` = não deu para consultar) só serve para dizer QUAL item falta e quanto.
 */
export function situacaoDaNota(d: DecisaoNota, itens: ItemDaNota[], estoquePa: Map<string, number | null>): SituacaoNota {
  if (d.acao === 'baixar') return { tipo: 'pode_baixar' }
  if (d.acao === 'manual') return { tipo: 'manual', motivo: TEXTO_MOTIVO[d.motivo] }
  const faltas: { codigo: string; falta: number }[] = []
  for (const [codigo, qtd] of quantidadePorCodigo(itens)) {
    const pa = estoquePa.get(codigo)
    if (pa == null) continue
    if (pa + 1e-9 < qtd) faltas.push({ codigo, falta: qtd - pa })
  }
  return { tipo: 'sem_saldo', motivo: TEXTO_MOTIVO[d.motivo], faltas }
}

export type PrevisaoNota =
  | { notaId: number; acao: 'baixa_agora' }
  | { notaId: number; acao: 'fila'; posicao: number }
  | { notaId: number; acao: 'manual' }
  | { notaId: number; acao: 'ja_na_fila' }

/**
 * O que a confirmação anuncia, na ordem em que a pessoa marcou. Duas notas que disputam o mesmo saldo: a
 * primeira marcada "baixa agora" e consome o estoque do PA; a outra entra na fila. É uma PREVISÃO — a baixa
 * relê a nota no Compels e o resultado de verdade vem depois.
 */
export function previsaoDaSelecao(
  selecao: { notaId: number; situacao: SituacaoNota; itens: ItemDaNota[]; naFila: boolean }[],
  estoquePa: Map<string, number | null>,
  tamanhoDaFila: number,
): PrevisaoNota[] {
  const restante = new Map(estoquePa)
  let fila = tamanhoDaFila
  return selecao.map((s): PrevisaoNota => {
    if (s.naFila) return { notaId: s.notaId, acao: 'ja_na_fila' }
    if (s.situacao.tipo === 'manual') return { notaId: s.notaId, acao: 'manual' }
    if (s.situacao.tipo === 'pode_baixar') {
      const precisa = quantidadePorCodigo(s.itens)
      const cobre = [...precisa].every(([c, q]) => {
        const r = restante.get(c)
        return r === undefined || r === null || r + 1e-9 >= q
      })
      if (cobre) {
        for (const [c, q] of precisa) {
          const r = restante.get(c)
          if (r != null) restante.set(c, r - q)
        }
        return { notaId: s.notaId, acao: 'baixa_agora' }
      }
    }
    fila += 1
    return { notaId: s.notaId, acao: 'fila', posicao: fila }
  })
}
