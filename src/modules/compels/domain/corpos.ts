import { numero, listaDe, objeto, RespostaInesperada, texto } from './leituras-erp'

/**
 * Corpos que a tela do Compels envia ao Requisitar e ao Apontar, montados a partir das respostas das
 * consultas que a tela faz ANTES de gravar (spec 16/10/2026, §2.6 e §2.10). Funções puras: não chamam
 * o ERP. A ordem dos campos replica a captura, e os testes comparam o JSON byte a byte com ela.
 */

function booleano(o: Record<string, unknown>, campo: string, onde: string): boolean {
  const v = o[campo]
  if (typeof v !== 'boolean') throw new RespostaInesperada(`${onde}.${campo}`)
  return v
}

// ---------- Requisitar ----------

/** Linha de `requisicaoOrdemProducao/verificaQuantidadeRequisitada` (um componente da BOM). */
export interface ComponenteRequisicao {
  itemId: number
  codigo: string
  rastreavel: boolean
  /** Vem do cadastro do item, dentro desta mesma resposta: a integração só repassa. */
  precoCusto: number
  quantidadeRequisitar: number
  quantidadeComposicao: number
  quantidadeRequisitadaDisponivel: number
  itemOrdemProducaoId: number
  itemFantasma: boolean
  saldo: number
}

export function componentesDeRequisicao(resposta: unknown): ComponenteRequisicao[] {
  return listaDe(resposta, 'verificaQuantidadeRequisitada').map((linha) => {
    const item = objeto(linha.item, 'componente.item')
    return {
      itemId: numero(item, 'id', 'componente.item'),
      codigo: texto(item, 'codigo', 'componente.item'),
      rastreavel: booleano(item, 'rastreavel', 'componente.item'),
      precoCusto: numero(item, 'precoCusto', 'componente.item'),
      quantidadeRequisitar: numero(linha, 'quantidadeRequisitar', 'componente'),
      quantidadeComposicao: numero(linha, 'quantidadeComposicao', 'componente'),
      quantidadeRequisitadaDisponivel: numero(linha, 'quantidadeRequisitadaDisponivel', 'componente'),
      itemOrdemProducaoId: numero(linha, 'itemOrdemProducaoId', 'componente'),
      itemFantasma: booleano(linha, 'itemFantasma', 'componente'),
      saldo: numero(linha, 'saldo', 'componente'),
    }
  })
}

/** Corpo (campo `jsonData`) de `verificaQuantidadeRequisitada`. */
export function consultaRequisitada(p: {
  opId: number
  tipoPropriedade: number
  produtoId: number
  negocianteId: number
  quantidade: number
}): Record<string, unknown> {
  return {
    ordemProducaoSimples: {
      tipoPropriedade: p.tipoPropriedade,
      operacaoMista: false,
      composicaoProduto: { item: { id: p.produtoId } },
      negociante: { id: String(p.negocianteId) },
      id: String(p.opId),
    },
    quantidade: p.quantidade,
  }
}

/** Corpo (campo `jsonData`) de `requisicaoOrdemProducao/save`. O nome `itemRequisicaOrdemProducaoList` (sem o "r") é o do ERP. */
export function corpoRequisicao(p: {
  opId: number
  tipoPropriedade: number
  quantidade: number
  componentes: readonly ComponenteRequisicao[]
}): Record<string, unknown> {
  return {
    ordemProducao: { id: String(p.opId), tipoPropriedade: p.tipoPropriedade },
    itemRequisicaOrdemProducaoList: p.componentes.map((c) => ({
      item: { id: c.itemId, codigo: c.codigo, rastreavel: c.rastreavel, precoCusto: c.precoCusto },
      quantidade: c.quantidadeRequisitar,
      quantidadeRequisitadaDisponivel: c.quantidadeRequisitadaDisponivel,
      quantidadeComposicao: c.quantidadeComposicao,
      itemEstoqueRequisicaoList: [],
      itemOrdemProducaoId: c.itemOrdemProducaoId,
      motivoRequisicao: '',
      itemFantasma: c.itemFantasma,
    })),
    quantidade: p.quantidade,
  }
}

// ---------- Apontar ----------

/** Linha de `apontamentoOrdemProducao/verificaDisponibilidade`. */
export interface ComponenteApontamento {
  itemId: number
  quantidadeUtilizada: number
  quantidadeComposicao: number
  itemOrdemProducaoId: number
  itemFantasma: boolean
  saldoDisponivel: number
}

export function componentesDeApontamento(resposta: unknown): ComponenteApontamento[] {
  return listaDe(resposta, 'verificaDisponibilidade').map((linha) => {
    const item = objeto(linha.item, 'componente.item')
    const vinculo = objeto(linha.itemOrdemProducaoSimples, 'componente.itemOrdemProducaoSimples')
    return {
      itemId: numero(item, 'id', 'componente.item'),
      quantidadeUtilizada: numero(linha, 'quantidadeUtilizada', 'componente'),
      quantidadeComposicao: numero(linha, 'quantidadeComposicao', 'componente'),
      itemOrdemProducaoId: numero(vinculo, 'id', 'componente.itemOrdemProducaoSimples'),
      itemFantasma: booleano(linha, 'itemFantasma', 'componente'),
      saldoDisponivel: numero(linha, 'saldoDisponivel', 'componente'),
    }
  })
}

/** Componentes cujo saldo não cobre o consumo do apontamento (a tela pinta de vermelho, "Saldo indisponível"). */
export function componentesSemSaldo(componentes: readonly ComponenteApontamento[]): ComponenteApontamento[] {
  return componentes.filter((c) => !c.itemFantasma && c.saldoDisponivel < c.quantidadeUtilizada)
}

/** Corpo (campos do formulário) de `apontamentoOrdemProducao/verificaDisponibilidade`. */
export function consultaDisponibilidade(p: { opId: number; quantidade: number; produtoId: number }): Record<string, string> {
  return {
    idOrdemProducao: String(p.opId),
    quantidadeApontar: String(p.quantidade),
    itemPaiId: String(p.produtoId),
    page: '1',
    start: '0',
    limit: '50',
  }
}

export interface DestinoEstoque {
  estoqueId: number
  locacaoId: number
}

/**
 * Corpo (campo `jsonData`) de `apontamentoOrdemProducao/save`. `dataInicio` e `dataFim` no formato
 * local da tela, `AAAA-MM-DDTHH:MM:SS`, sem fuso.
 */
export function corpoApontamento(p: {
  opId: number
  produtoId: number
  quantidade: number
  dataInicio: string
  dataFim: string
  componentes: readonly ComponenteApontamento[]
  destino: DestinoEstoque
  observacao?: string
}): Record<string, unknown> {
  return {
    ordemProducao: { id: String(p.opId) },
    item: { id: String(p.produtoId) },
    quantidadeProduzida: p.quantidade,
    refugo: 0,
    quantidadeCancelada: 0,
    dataInicio: p.dataInicio,
    dataFim: p.dataFim,
    ordemProducaoSimplesInspecao: { id: null },
    itemApontamentoOrdemProducaoList: p.componentes.map((c) => ({
      item: { id: c.itemId },
      quantidadeUtilizada: c.quantidadeUtilizada,
      quantidadePerda: 0,
      quantidadePerdaRefugo: 0,
      quantidadeCancelada: 0,
      quantidadeComposicao: c.quantidadeComposicao,
      motivo: '',
      itemOrdemProducaoSimples: { id: c.itemOrdemProducaoId },
      itemFantasma: c.itemFantasma,
    })),
    produziu: false,
    tipoApontamento: 0,
    observacao: p.observacao ?? '',
    taraPorTipoMaterial: { id: null },
    quantidadePesada: 0,
    taraMaterialTotal: 0,
    quantidadeGanho: 0,
    classificacaoApontamento: { id: null },
    estoqueRemanejamento: { id: null },
    itemLote: {
      itemLoteEstoque: {
        estoque: { id: p.destino.estoqueId, descontaPendenciaProducao: false },
        itemLoteEstoqueLocacao: { locacao: { id: p.destino.locacaoId } },
      },
      numeroLoteFabricacao: '',
      dataFabricacao: null,
      dataValidade: null,
      estoque: { id: p.destino.estoqueId },
    },
    empenhar: true,
  }
}

/** Data/hora no formato da tela, no fuso de São Paulo (o ERP não recebe fuso). */
export function dataHoraLocal(instante: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instante)
  const g = (t: string) => partes.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}:${g('second')}`
}

/** Meia-noite do dia local de `instante` (é o `dataInicio` quando o apontamento é o primeiro da OP). */
export function inicioDoDia(instante: Date): string {
  return `${dataHoraLocal(instante).slice(0, 10)}T00:00:00`
}
