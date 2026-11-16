import { describe, expect, it } from 'vitest'
import { avaliarNota, lerNota, ordenarPorEmissao, codigoDaLinha, type NotaPendente } from '../baixa-nf'

const nota: NotaPendente = {
  id: 62476, numero: 78817, empresaId: 133, emissao: '2026-11-20',
  codigoRemetente: 'X', razaoSocialNomeRemetente: 'Y', informacoesComplementares: '',
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

const base = { nota, emTerceiros: [], deTerceiros: [], desde: '2026-11-17', usuario: 'ShopFloor' }

describe('avaliarNota', () => {
  it('nota emitida antes do corte nunca é tocada (ex.: NF 74202 de 2025)', () => {
    expect(avaliarNota({ ...base, nota: { ...nota, emissao: '2025-07-25' }, proprias: [linha()] })).toEqual({ acao: 'fora_da_janela' })
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
