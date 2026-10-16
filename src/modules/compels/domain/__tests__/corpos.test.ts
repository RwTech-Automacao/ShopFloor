import { describe, expect, it } from 'vitest'
import {
  componentesDeApontamento,
  componentesDeRequisicao,
  componentesSemSaldo,
  consultaDisponibilidade,
  consultaRequisitada,
  corpoApontamento,
  corpoRequisicao,
  dataHoraLocal,
  inicioDoDia,
} from '../corpos'
import { RespostaInesperada } from '../leituras-erp'

// ---- Ensaio sem gravar: os corpos abaixo foram CAPTURADOS da tela do Compels em 16/10/2026
// (OP 8649, id 13027, produto PRT446 id 22078, 2 componentes). O corpo montado tem de ser idêntico, byte a byte.

const CAPTURA_CONSULTA_REQUISITADA =
  '{"ordemProducaoSimples":{"tipoPropriedade":0,"operacaoMista":false,"composicaoProduto":{"item":{"id":22078}},"negociante":{"id":"1679"},"id":"13027"},"quantidade":1000}'

const CAPTURA_REQUISICAO_SAVE =
  '{"ordemProducao":{"id":"13027","tipoPropriedade":0},"itemRequisicaOrdemProducaoList":[{"item":{"id":12225,"codigo":"RWCI57","rastreavel":false,"precoCusto":1.5476},"quantidade":1000,"quantidadeRequisitadaDisponivel":0,"quantidadeComposicao":1000,"itemEstoqueRequisicaoList":[],"itemOrdemProducaoId":138103,"motivoRequisicao":"","itemFantasma":false},{"item":{"id":19793,"codigo":"RWPC99","rastreavel":false,"precoCusto":0.2762},"quantidade":1000,"quantidadeRequisitadaDisponivel":0,"quantidadeComposicao":1000,"itemEstoqueRequisicaoList":[],"itemOrdemProducaoId":138104,"motivoRequisicao":"","itemFantasma":false}],"quantidade":1000}'

const CAPTURA_APONTAMENTO_SAVE =
  '{"ordemProducao":{"id":"13027"},"item":{"id":"22078"},"quantidadeProduzida":55,"refugo":0,"quantidadeCancelada":0,"dataInicio":"2026-10-16T00:00:00","dataFim":"2026-10-16T15:32:21","ordemProducaoSimplesInspecao":{"id":null},"itemApontamentoOrdemProducaoList":[{"item":{"id":12225},"quantidadeUtilizada":55,"quantidadePerda":0,"quantidadePerdaRefugo":0,"quantidadeCancelada":0,"quantidadeComposicao":1,"motivo":"","itemOrdemProducaoSimples":{"id":138103},"itemFantasma":false},{"item":{"id":19793},"quantidadeUtilizada":55,"quantidadePerda":0,"quantidadePerdaRefugo":0,"quantidadeCancelada":0,"quantidadeComposicao":1,"motivo":"","itemOrdemProducaoSimples":{"id":138104},"itemFantasma":false}],"produziu":false,"tipoApontamento":0,"observacao":"","taraPorTipoMaterial":{"id":null},"quantidadePesada":0,"taraMaterialTotal":0,"quantidadeGanho":0,"classificacaoApontamento":{"id":null},"estoqueRemanejamento":{"id":null},"itemLote":{"itemLoteEstoque":{"estoque":{"id":224,"descontaPendenciaProducao":false},"itemLoteEstoqueLocacao":{"locacao":{"id":5314}}},"numeroLoteFabricacao":"","dataFabricacao":null,"dataValidade":null,"estoque":{"id":224}},"empenhar":true}'

// Respostas das consultas, no formato visto na sonda (só os campos que a integração lê).
const linhaRequisicao = (id: number, codigo: string, custo: number, ordemItem: number) => ({
  item: { id, codigo, rastreavel: false, precoCusto: custo },
  quantidadeRequisitar: 1000, quantidadeComposicao: 1000, quantidadeRequisitadaDisponivel: 0,
  itemOrdemProducaoId: ordemItem, itemFantasma: false, saldo: 1000,
})
const RESPOSTA_REQUISITADA = {
  data: [linhaRequisicao(12225, 'RWCI57', 1.5476, 138103), linhaRequisicao(19793, 'RWPC99', 0.2762, 138104)],
  success: true,
}
const linhaDisponibilidade = (id: number, ordemItem: number, saldo = 1000) => ({
  item: { id, codigo: `ITEM${id}` }, quantidadeUtilizada: 55, quantidadeComposicao: 1,
  itemOrdemProducaoSimples: { id: ordemItem }, itemFantasma: false, saldoDisponivel: saldo,
})
const RESPOSTA_DISPONIBILIDADE = {
  data: [linhaDisponibilidade(12225, 138103), linhaDisponibilidade(19793, 138104)],
  success: true,
}

describe('ensaio dos corpos contra a captura de 16/10', () => {
  it('consulta de requisição', () => {
    const corpo = consultaRequisitada({ opId: 13027, tipoPropriedade: 0, produtoId: 22078, negocianteId: 1679, quantidade: 1000 })
    expect(JSON.stringify(corpo)).toBe(CAPTURA_CONSULTA_REQUISITADA)
  })

  it('corpo do Requisitar (precoCusto repassado da própria consulta)', () => {
    const componentes = componentesDeRequisicao(RESPOSTA_REQUISITADA)
    const corpo = corpoRequisicao({ opId: 13027, tipoPropriedade: 0, quantidade: 1000, componentes })
    expect(JSON.stringify(corpo)).toBe(CAPTURA_REQUISICAO_SAVE)
  })

  it('consulta de disponibilidade do Apontar', () => {
    expect(consultaDisponibilidade({ opId: 13027, quantidade: 55, produtoId: 22078 })).toEqual({
      idOrdemProducao: '13027', quantidadeApontar: '55', itemPaiId: '22078', page: '1', start: '0', limit: '50',
    })
  })

  it('corpo do Apontar', () => {
    const componentes = componentesDeApontamento(RESPOSTA_DISPONIBILIDADE)
    const corpo = corpoApontamento({
      opId: 13027, produtoId: 22078, quantidade: 55,
      dataInicio: '2026-10-16T00:00:00', dataFim: '2026-10-16T15:32:21',
      componentes, destino: { estoqueId: 224, locacaoId: 5314 },
    })
    expect(JSON.stringify(corpo)).toBe(CAPTURA_APONTAMENTO_SAVE)
  })

  it('o destino do posto Almoxarifado (estoque 217 PA, locação 5314 Padrão) entra nos dois lugares do corpo', () => {
    const corpo = corpoApontamento({
      opId: 1, produtoId: 2, quantidade: 1, dataInicio: 'a', dataFim: 'b', componentes: [],
      destino: { estoqueId: 217, locacaoId: 5314 },
    }) as { itemLote: { itemLoteEstoque: { estoque: { id: number }; itemLoteEstoqueLocacao: { locacao: { id: number } } }; estoque: { id: number } } }
    expect(corpo.itemLote.itemLoteEstoque.estoque.id).toBe(217)
    expect(corpo.itemLote.estoque.id).toBe(217)
    expect(corpo.itemLote.itemLoteEstoque.itemLoteEstoqueLocacao.locacao.id).toBe(5314)
  })

  it('a observação vai no corpo (marca de idempotência), vazia por padrão', () => {
    const base = { opId: 1, produtoId: 2, quantidade: 1, dataInicio: 'a', dataFim: 'b', componentes: [], destino: { estoqueId: 217, locacaoId: 5314 } }
    expect(corpoApontamento(base).observacao).toBe('')
    expect(corpoApontamento({ ...base, observacao: 'ShopFloor #123' }).observacao).toBe('ShopFloor #123')
  })
})

describe('leitura das consultas', () => {
  it('campo ausente nas consultas vira RespostaInesperada (não monta corpo com valor inventado)', () => {
    const semCusto = { data: [{ ...linhaRequisicao(1, 'X', 1, 1), item: { id: 1, codigo: 'X', rastreavel: false } }] }
    expect(() => componentesDeRequisicao(semCusto)).toThrow(RespostaInesperada)
    const semVinculo = { data: [{ item: { id: 1, codigo: 'X' }, quantidadeUtilizada: 1, quantidadeComposicao: 1, itemFantasma: false, saldoDisponivel: 1 }] }
    expect(() => componentesDeApontamento(semVinculo)).toThrow(RespostaInesperada)
  })

  it('componentesSemSaldo acusa o componente cujo saldo não cobre o consumo (falta de saldo)', () => {
    const resposta = { data: [linhaDisponibilidade(12225, 138103, 1000), linhaDisponibilidade(19793, 138104, 40)] }
    const faltam = componentesSemSaldo(componentesDeApontamento(resposta))
    expect(faltam.map((c) => c.itemId)).toEqual([19793])
  })

  it('componente fantasma não conta como falta de saldo', () => {
    const fantasma = { data: [{ ...linhaDisponibilidade(1, 1, 0), itemFantasma: true }] }
    expect(componentesSemSaldo(componentesDeApontamento(fantasma))).toEqual([])
  })
})

describe('datas no fuso de São Paulo', () => {
  it('formata como a tela, sem fuso', () => {
    expect(dataHoraLocal(new Date('2026-10-16T18:32:21Z'))).toBe('2026-10-16T15:32:21')
  })

  it('o início do dia usa o dia de São Paulo, não o de UTC', () => {
    expect(inicioDoDia(new Date('2026-10-17T01:30:00Z'))).toBe('2026-10-16T00:00:00')
  })
})
