import { q6 } from './estado-op'
import { numero, objeto, RespostaInesperada, texto } from './leituras-erp'

/**
 * "Pagar Pendência" do Compels: quando um empenho ou uma requisição fica 'Pendente' (faltou saldo de algum
 * componente na hora), a tela tem um botão que empenha/requisita SÓ o que faltou. Mapeado do HAR de 06/11/2026
 * (OP 8682): o apontamento de 320 falhou com "saldo requisitado insuficiente" e passou depois de pagar a pendência
 * do empenho e da requisição.
 *
 * Funções puras: recebem o DETALHE do documento (`empenho/findById/{id}` ou `requisicaoOrdemProducao/findById`) e
 * devolvem o corpo que a tela manda, com SÓ os itens que têm pendência. `null` = nada pendente.
 */
export interface ItemPago {
  codigo: string
  quantidade: number
}

export interface PagamentoPendencia {
  /** Número do documento (empenho/requisição) na OP, para a mensagem. */
  numero: number
  corpo: Record<string, unknown>
  itens: ItemPago[]
}

/** Pendência que a integração não paga sozinha (ex.: item rastreável, que pede escolher lote/série na tela). */
export class PendenciaManual extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'PendenciaManual'
  }
}

type Json = unknown

function detalheDe(resposta: Json, onde: string): Record<string, Json> {
  const o = objeto(resposta, onde)
  return typeof o.data === 'object' && o.data !== null && !Array.isArray(o.data) ? objeto(o.data, onde) : o
}

function lista(o: Record<string, Json>, campo: string, onde: string): Record<string, Json>[] {
  const v = o[campo]
  if (!Array.isArray(v)) throw new RespostaInesperada(`${onde}.${campo}`)
  return v.map((x) => objeto(x, `${onde}.${campo}`))
}

/** O cabeçalho da OP como a tela o manda: ids como TEXTO, negociante só com o id. */
function opDoCorpo(d: Record<string, Json>, onde: string) {
  const op = objeto(d.ordemProducao, `${onde}.ordemProducao`)
  const negociante = objeto(op.negociante, `${onde}.ordemProducao.negociante`)
  return {
    op,
    id: String(numero(op, 'id', `${onde}.ordemProducao`)),
    numero: String(numero(op, 'numero', `${onde}.ordemProducao`)),
    tipoPropriedade: numero(op, 'tipoPropriedade', `${onde}.ordemProducao`),
    negociante: { id: String(numero(negociante, 'id', `${onde}.ordemProducao.negociante`)) },
    operacaoMista: op.operacaoMista === true,
  }
}

function itemDoCorpo(i: Record<string, Json>, onde: string) {
  const item = objeto(i.item, `${onde}.item`)
  return { item, id: numero(item, 'id', `${onde}.item`), codigo: texto(item, 'codigo', `${onde}.item`) }
}

/** A filha (OP do componente semiacabado) vai inteira, como veio; ausente/nula não vai. */
function filha(i: Record<string, Json>): Record<string, Json> {
  return typeof i.ordemProducaoFilha === 'object' && i.ordemProducaoFilha !== null ? { ordemProducaoFilha: i.ordemProducaoFilha } : {}
}

function pendentes(itens: Record<string, Json>[], onde: string): Record<string, Json>[] {
  return itens.filter((i) => q6(numero(i, 'quantidadePendente', onde)) > 0)
}

export function corpoPendenciaEmpenho(resposta: Json): PagamentoPendencia | null {
  const onde = 'empenho'
  const d = detalheDe(resposta, onde)
  const itens = pendentes(lista(d, 'itemEmpenhoOrdemProducaoList', onde), `${onde}.item`)
  if (itens.length === 0) return null
  const op = opDoCorpo(d, onde)
  const n = numero(d, 'numero', onde)

  const linhas = itens.map((i) => {
    const it = itemDoCorpo(i, `${onde}.item`)
    const pendente = numero(i, 'quantidadePendente', `${onde}.item`)
    return {
      item: { id: it.id, codigo: it.codigo },
      quantidadeEmpenhar: pendente,
      quantidadeEmpenhada: numero(i, 'quantidadeEmpenhada', `${onde}.item`),
      itemOrdemProducaoId: numero(i, 'itemOrdemProducaoId', `${onde}.item`),
      id: numero(i, 'id', `${onde}.item`),
      ...filha(i),
      quantidadePendente: pendente,
      quantidadeComposicao: numero(i, 'quantidadeComposicao', `${onde}.item`),
      itemFantasma: i.itemFantasma === true,
    }
  })

  return {
    numero: n,
    itens: linhas.map((l) => ({ codigo: l.item.codigo, quantidade: l.quantidadePendente })),
    corpo: {
      id: String(numero(d, 'id', onde)),
      numero: String(n),
      ordemProducao: {
        id: op.id, numero: op.numero, tipoPropriedade: op.tipoPropriedade, negociante: op.negociante, operacaoMista: op.operacaoMista,
      },
      quantidade: numero(d, 'quantidade', onde),
      quantidadeEmpenhada: numero(d, 'quantidadeEmpenhada', onde),
      quantidadeEstornar: numero(d, 'quantidadeEstornar', onde),
      quantidadeRequisitada: numero(d, 'quantidadeRequisitada', onde),
      itemEmpenhoOrdemProducaoList: linhas,
    },
  }
}

export function corpoPendenciaRequisicao(resposta: Json): PagamentoPendencia | null {
  const onde = 'requisicao'
  const d = detalheDe(resposta, onde)
  const itens = pendentes(lista(d, 'itemRequisicaOrdemProducaoList', onde), `${onde}.item`)
  if (itens.length === 0) return null
  const op = opDoCorpo(d, onde)
  const n = numero(d, 'numero', onde)
  const composicao = objeto(objeto(op.op.composicaoProduto, `${onde}.composicaoProduto`).item, `${onde}.composicaoProduto.item`)

  const linhas = itens.map((i) => {
    const it = itemDoCorpo(i, `${onde}.item`)
    // Item rastreável pede escolher lote/número de série (itemEstoqueRequisicaoList) na tela: fica manual.
    if (it.item.rastreavel === true) {
      throw new PendenciaManual(`O componente ${it.codigo} é rastreável: pague a pendência da requisição nº ${n} à mão no Compels.`)
    }
    const pendente = numero(i, 'quantidadePendente', `${onde}.item`)
    return {
      item: { id: it.id, codigo: it.codigo, rastreavel: false },
      quantidade: pendente,
      quantidadePendente: pendente,
      itemEstoqueRequisicaoList: [],
      itemOrdemProducaoId: numero(i, 'itemOrdemProducaoId', `${onde}.item`),
      motivoRequisicao: '',
      ...filha(i),
      id: numero(i, 'id', `${onde}.item`),
      // A tela manda o JÁ requisitado do item e a composição calculada (o `quantidadeComposicao` do detalhe vem 0).
      quantidadeRequisitadaProduto: numero(i, 'quantidade', `${onde}.item`),
      quantidadeComposicao: numero(i, 'quantidadeComposicaoCalculada', `${onde}.item`),
      itemFantasma: i.itemFantasma === true,
    }
  })

  return {
    numero: n,
    itens: linhas.map((l) => ({ codigo: l.item.codigo, quantidade: l.quantidadePendente })),
    corpo: {
      ordemProducao: {
        id: op.id, tipoPropriedade: op.tipoPropriedade, numero: op.numero,
        composicaoProduto: { item: { id: numero(composicao, 'id', `${onde}.composicaoProduto.item`) } },
        negociante: op.negociante, operacaoMista: op.operacaoMista,
      },
      numero: String(n),
      itemRequisicaOrdemProducaoList: linhas,
      quantidade: numero(d, 'quantidade', onde),
      id: String(numero(d, 'id', onde)),
    },
  }
}

/** "requisição nº 2: PRT706 +498" — para o aviso e para a mensagem de erro. */
export function descreverPagamento(tipo: 'empenho' | 'requisição', p: PagamentoPendencia): string {
  return `${tipo} nº ${p.numero}: ${p.itens.map((i) => `${i.codigo} +${i.quantidade}`).join(', ')}`
}
