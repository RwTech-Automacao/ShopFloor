import { describe, expect, it } from 'vitest'
import {
  avaliarNota, lerNota, ordenarPorEmissao, codigoDaLinha, pedidoDeVenda, itensDaNota, situacaoDaNota, previsaoDaSelecao,
  type NotaPendente,
} from '../baixa-nf'

const nota: NotaPendente = {
  id: 62476, numero: 78817, empresaId: 133, emissao: '2026-11-20',
  codigoRemetente: 'X', razaoSocialNomeRemetente: 'Y', informacoesComplementares: '',
  clienteCodigo: 'X', clienteNome: 'Y', valor: null, pedidoVenda: '', natureza: '',
}

function linha(p: { item?: number; pedido?: number; qtd?: number; estoque?: string; saldo?: number; loc?: number; lote?: number | null; rastreavel?: boolean } = {}) {
  return {
    id: 1, quantidade: p.qtd ?? 10, unidade: 'UN', baixaEmTerceiros: false, itemPedidoVendaItemLote: null,
    itemNotaICMS: { id: p.item ?? 500, quantidadeInterna: p.pedido ?? 10, numeroItemPedidoVenda: 'PMOD44' },
    itemLote: p.lote === null ? null : {
      id: p.lote ?? 900, item: { id: 77, rastreavel: p.rastreavel ?? false, codigo: 'PMOD44' },
      itemLoteEstoque: {
        id: 40, tipoPropriedadeEstoque: 0, negociante: { id: 3 }, estoque: { id: 217, codigo: p.estoque ?? 'PA' },
        itemLoteEstoqueLocacao: { id: p.loc ?? 5314, saldo: p.saldo ?? 100 },
      },
    },
  }
}

const base = { nota, emTerceiros: [], deTerceiros: [], usuario: 'ShopFloor' }

describe('avaliarNota', () => {
  it('sem data de corte: a NF 74202 (2025) é avaliada como qualquer outra', () => {
    expect(avaliarNota({ ...base, nota: { ...nota, emissao: '2025-07-25' }, proprias: [linha()] }).acao).toBe('baixar')
  })

  it('sem lote com saldo, lote fora do PA ou saldo insuficiente → espera', () => {
    expect(avaliarNota({ ...base, proprias: [linha({ lote: null, qtd: 0 })] })).toEqual({ acao: 'esperar', motivo: 'sem_saldo_pa' })
    expect(avaliarNota({ ...base, proprias: [linha({ estoque: 'EPD' })] })).toEqual({ acao: 'esperar', motivo: 'sem_saldo_pa' })
    expect(avaliarNota({ ...base, proprias: [linha({ saldo: 9 })] })).toEqual({ acao: 'esperar', motivo: 'sem_saldo_pa' })
    // duas linhas da mesma locação somam mais que o saldo
    expect(avaliarNota({ ...base, proprias: [linha({ item: 1, pedido: 6, qtd: 6, saldo: 10 }), linha({ item: 2, pedido: 6, qtd: 6, saldo: 10 })] }))
      .toEqual({ acao: 'esperar', motivo: 'sem_saldo_pa' })
  })

  it('o lote proposto não cobre a quantidade da nota → espera (nunca baixa parcial)', () => {
    expect(avaliarNota({ ...base, proprias: [linha({ pedido: 10, qtd: 4 })] })).toEqual({ acao: 'esperar', motivo: 'quantidade_incompleta' })
  })

  it('item rastreável ou linhas em terceiros → baixa manual', () => {
    expect(avaliarNota({ ...base, proprias: [linha({ rastreavel: true })] })).toEqual({ acao: 'manual', motivo: 'rastreavel' })
    expect(avaliarNota({ ...base, proprias: [linha()], emTerceiros: [{}] })).toEqual({ acao: 'manual', motivo: 'linhas_em_terceiros' })
    expect(avaliarNota({ ...base, proprias: [] })).toEqual({ acao: 'manual', motivo: 'sem_itens' })
  })

  it('nota completa no PA → corpo no formato do baixar da tela', () => {
    const d = avaliarNota({ ...base, proprias: [linha({ item: 1, pedido: 6, qtd: 4, lote: 901 }), linha({ item: 1, pedido: 6, qtd: 2, lote: 902, loc: 5315 })] })
    expect(d.acao).toBe('baixar')
    if (d.acao !== 'baixar') return
    expect(d.itens).toEqual([{ codigo: 'PMOD44', quantidade: 6 }])
    const c = d.corpo as Record<string, unknown>
    expect(c.notaICMS).toMatchObject({ numero: 78817, id: 62476, empresa: { id: 133 }, usuarioAceiteBaixa: 'ShopFloor' })
    expect(c.itemNotaICMSItemLoteEstoqueEmTerceirosList).toEqual([])
    expect(c.itemNotaICMSItemLoteEstoqueDeTerceirosList).toEqual([])
    const l0 = (c.itemNotaICMSItemLoteEstoqueProprioList as Record<string, unknown>[])[0]!
    expect(l0).toMatchObject({
      quantidade: 4, unidade: 'UN', itemLoteNumeroSerieList: [],
      itemNotaICMS: { id: 1, empresa: { id: 133 }, quantidadeInterna: 6 },
      itemLote: { id: 901, item: { id: 77, rastreavel: false }, itemLoteEstoque: { estoque: { id: 217, codigo: 'PA' }, itemLoteEstoqueLocacao: { id: 5314 } } },
      itemPedidoVendaItemLote: { id: '', quantidade: '' },
    })
  })
})

describe('lista de notas', () => {
  it('lê a nota da lista e ordena da mais antiga para a mais nova', () => {
    const a = lerNota({ id: 2, numero: 80, empresa: { id: 133 }, dataHoraEmissao: '2026-11-21 10:00:00' })!
    const b = lerNota({ id: 1, numero: 90, empresa: { id: 133 }, dataHoraEmissao: '2026-11-20 16:00:00' })!
    expect(ordenarPorEmissao([a, b]).map((n) => n.numero)).toEqual([90, 80])
    expect(lerNota({ id: 1, numero: 2 })).toBeNull()
  })

  it('código do produto: do item do lote; sem lote, o que a nota traz', () => {
    expect(codigoDaLinha(linha())).toBe('PMOD44')
    expect(codigoDaLinha(linha({ lote: null }))).toBe('PMOD44')
  })
})

describe('campos de exibição', () => {
  it('lê cliente, valor, pedido de venda e natureza da nota', () => {
    const n = lerNota({
      id: 1, numero: 80, empresa: { id: 133 }, dataHoraEmissao: '2026-11-20 16:00:00',
      codigoRemetente: 'C123', razaoSocialNomeRemetente: 'ACME LTDA', totalNota: 1530.5,
      observacoesFinanceiro: 'Ref. Pedido de Venda 2836/26 - pagamento 30 dias',
      naturezaOperacao: { id: 4, descricao: 'VENDA DE PRODUÇÃO' },
    })!
    expect(n).toMatchObject({ clienteCodigo: 'C123', clienteNome: 'ACME LTDA', valor: 1530.5, pedidoVenda: '2836/26', natureza: 'VENDA DE PRODUÇÃO' })
    const m = lerNota({ id: 1, numero: 80, empresa: { id: 133 }, dataHoraEmissao: '2026-11-20', naturezaOperacao: 'REMESSA' })!
    expect(m).toMatchObject({ clienteCodigo: '', clienteNome: '', valor: null, pedidoVenda: '', natureza: 'REMESSA' })
  })

  it('pedido de venda do texto; sem o padrão, vazio', () => {
    expect(pedidoDeVenda('Pedido de Venda 2836/26')).toBe('2836/26')
    expect(pedidoDeVenda('pedido de venda nº 1234')).toBe('1234')
    expect(pedidoDeVenda('sem pedido aqui')).toBe('')
    expect(pedidoDeVenda('')).toBe('')
  })

  it('itens da nota: um por item, com descrição e quantidade da nota (linhas de lote somam uma vez só)', () => {
    const l1 = { ...linha({ item: 1, pedido: 6, qtd: 4 }), itemNotaICMS: { id: 1, quantidadeInterna: 6, descricao: 'MÓDULO 44', numeroItemPedidoVenda: 'PMOD44' } }
    const l2 = { ...linha({ item: 1, pedido: 6, qtd: 2 }), itemNotaICMS: { id: 1, quantidadeInterna: 6, descricao: 'MÓDULO 44', numeroItemPedidoVenda: 'PMOD44' } }
    const l3 = { quantidade: 0, itemLote: null, itemNotaICMS: { id: 2, quantidadeInterna: 3, item: { codigo: 'PRT446', descricao: 'PLACA' } } }
    expect(itensDaNota([l1, l2, l3])).toEqual([
      { codigo: 'PMOD44', descricao: 'MÓDULO 44', quantidade: 6 },
      { codigo: 'PRT446', descricao: 'PLACA', quantidade: 3 },
    ])
  })
})

describe('situacaoDaNota', () => {
  const itens = [{ codigo: 'PMOD44', descricao: '', quantidade: 10 }, { codigo: 'PRT446', descricao: '', quantidade: 5 }]
  it('baixar → pode baixar; manual → manual com o motivo', () => {
    expect(situacaoDaNota({ acao: 'baixar', corpo: {}, itens: [] }, itens, new Map())).toEqual({ tipo: 'pode_baixar' })
    expect(situacaoDaNota({ acao: 'manual', motivo: 'rastreavel' }, itens, new Map()))
      .toEqual({ tipo: 'manual', motivo: 'item com controle de número de série no Compels — baixar à mão' })
  })
  it('sem saldo: diz qual item e quanto falta pelo estoque do PA', () => {
    const pa = new Map<string, number | null>([['PMOD44', 4], ['PRT446', 9]])
    expect(situacaoDaNota({ acao: 'esperar', motivo: 'sem_saldo_pa' }, itens, pa)).toEqual({
      tipo: 'sem_saldo', motivo: 'ainda sem saldo no estoque PA', faltas: [{ codigo: 'PMOD44', falta: 6 }],
    })
    // estoque desconhecido (consulta falhou): não inventa a falta
    expect(situacaoDaNota({ acao: 'esperar', motivo: 'sem_saldo_pa' }, itens, new Map([['PMOD44', null]])))
      .toMatchObject({ tipo: 'sem_saldo', faltas: [] })
  })
})

describe('previsaoDaSelecao', () => {
  const nota = (notaId: number, tipo: 'pode_baixar' | 'sem_saldo' | 'manual', qtd = 10, naFila = false) => ({
    notaId, naFila, itens: [{ codigo: 'PMOD44', descricao: '', quantidade: qtd }],
    situacao: tipo === 'pode_baixar' ? { tipo } as const : tipo === 'manual' ? { tipo, motivo: 'm' } as const : { tipo, motivo: 's', faltas: [] },
  })
  it('na ordem marcada: baixa agora enquanto o PA cobre; depois entra na fila atrás das que já estão', () => {
    const pa = new Map<string, number | null>([['PMOD44', 15]])
    expect(previsaoDaSelecao([nota(1, 'pode_baixar'), nota(2, 'pode_baixar'), nota(3, 'manual'), nota(4, 'sem_saldo'), nota(5, 'sem_saldo', 1, true)], pa, 3))
      .toEqual([
        { notaId: 1, acao: 'baixa_agora' },
        { notaId: 2, acao: 'fila', posicao: 4 },
        { notaId: 3, acao: 'manual' },
        { notaId: 4, acao: 'fila', posicao: 5 },
        { notaId: 5, acao: 'ja_na_fila' },
      ])
  })
})
