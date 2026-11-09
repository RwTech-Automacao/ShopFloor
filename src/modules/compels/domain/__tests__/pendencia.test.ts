import { describe, expect, it } from 'vitest'
import { RespostaInesperada } from '../leituras-erp'
import { corpoPendenciaEmpenho, corpoPendenciaRequisicao, PendenciaManual } from '../pendencia'

// Recortes das respostas reais de 06/11/2026 (OP 8682): `empenho/findById/7241` e `requisicaoOrdemProducao/findById`
// (id 18510). Os corpos esperados são os que a TELA do Compels mandou em "Pagar Pendência" na mesma sessão.
const FILHA = {
  tipoPropriedade: 0,
  negociante: { inativo: false, realizaOperacoesTrocaGarantida: false, bloqueado: false, itemEntradaXMLPorCodigoBarra: false, clienteVipOTRS: false, inativoEmpresa: false, id: 1679 },
  operacaoMista: false, quantidadeRequisitada: 0, quantidadeEmpenhada: 0, quantidadeProduzida: 0, quantidadeCancelada: 0,
  quantidadeRefugo: 0, statusProcessamento: 0, id: 13061,
}
const OP_EMBUTIDA = {
  id: 13060, numero: 8682, tipoPropriedade: 0, operacaoMista: false,
  negociante: { id: 1679, inativo: false }, composicaoProduto: { item: { id: 28224, codigo: 'PMOF52' } },
}

const EMPENHO_7241 = {
  id: 7241, numero: 2, quantidade: 978, quantidadeEmpenhada: 1000, quantidadeEstornar: 0, quantidadeRequisitada: 978,
  ordemProducao: OP_EMBUTIDA,
  itemEmpenhoOrdemProducaoList: [
    {
      id: 103790, itemOrdemProducaoId: 138764, itemFantasma: false, item: { id: 28258, codigo: 'PRT706', rastreavel: false },
      quantidadeEmpenhada: 800, quantidadeComposicao: 978, quantidadeEmpenhar: 0, quantidadePendente: 178, ordemProducaoFilha: FILHA,
    },
    {
      id: 103791, itemOrdemProducaoId: 138763, itemFantasma: false, item: { id: 22649, codigo: 'RWC083', rastreavel: false },
      quantidadeEmpenhada: 978, quantidadeComposicao: 978, quantidadeEmpenhar: 0, quantidadePendente: 0, ordemProducaoFilha: null,
    },
  ],
}

const REQUISICAO_18510 = {
  data: {
    id: 18510, numero: 2, quantidade: 978, quantidadeApontada: 480, quantidadeRequisitada: 1000,
    ordemProducao: OP_EMBUTIDA,
    itemRequisicaOrdemProducaoList: [
      {
        id: 141230, itemOrdemProducaoId: 138764, itemFantasma: false, item: { id: 28258, codigo: 'PRT706', rastreavel: false },
        quantidade: 480, quantidadeComposicao: 0, quantidadeComposicaoCalculada: 978, quantidadePendente: 498,
        quantidadeRequisitadaProduto: 0, motivoRequisicao: null, ordemProducaoFilha: FILHA,
      },
      {
        id: 141231, itemOrdemProducaoId: 138763, itemFantasma: false, item: { id: 22649, codigo: 'RWC083', rastreavel: false },
        quantidade: 978, quantidadeComposicao: 0, quantidadeComposicaoCalculada: 978, quantidadePendente: 0,
        quantidadeRequisitadaProduto: 0, motivoRequisicao: null, ordemProducaoFilha: null,
      },
    ],
  },
  success: true,
}

describe('corpoPendenciaEmpenho', () => {
  it('monta o mesmo corpo que a tela mandou: só os itens pendentes, empenhando o que falta', () => {
    const p = corpoPendenciaEmpenho(EMPENHO_7241)
    expect(p?.itens).toEqual([{ codigo: 'PRT706', quantidade: 178 }])
    expect(p?.numero).toBe(2)
    expect(p?.corpo).toEqual({
      id: '7241', numero: '2',
      ordemProducao: { id: '13060', numero: '8682', tipoPropriedade: 0, negociante: { id: '1679' }, operacaoMista: false },
      quantidade: 978, quantidadeEmpenhada: 1000, quantidadeEstornar: 0, quantidadeRequisitada: 978,
      itemEmpenhoOrdemProducaoList: [{
        item: { id: 28258, codigo: 'PRT706' }, quantidadeEmpenhar: 178, quantidadeEmpenhada: 800, itemOrdemProducaoId: 138764,
        id: 103790, ordemProducaoFilha: FILHA, quantidadePendente: 178, quantidadeComposicao: 978, itemFantasma: false,
      }],
    })
  })

  it('nada pendente: null (não chama o Compels à toa)', () => {
    const semPendencia = {
      ...EMPENHO_7241,
      itemEmpenhoOrdemProducaoList: EMPENHO_7241.itemEmpenhoOrdemProducaoList.map((i) => ({ ...i, quantidadePendente: 0 })),
    }
    expect(corpoPendenciaEmpenho(semPendencia)).toBeNull()
  })

  it('item sem ordemProducaoFilha: o campo não vai no corpo', () => {
    const r = corpoPendenciaEmpenho({
      ...EMPENHO_7241,
      itemEmpenhoOrdemProducaoList: [{ ...EMPENHO_7241.itemEmpenhoOrdemProducaoList[1], quantidadePendente: 5 }],
    })
    expect(r?.corpo.itemEmpenhoOrdemProducaoList).toEqual([expect.not.objectContaining({ ordemProducaoFilha: expect.anything() })])
  })

  it('campo que falta: RespostaInesperada (não monta corpo pela metade)', () => {
    const { quantidadeEstornar: _q, ...semCampo } = EMPENHO_7241 // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(() => corpoPendenciaEmpenho(semCampo)).toThrow(RespostaInesperada)
  })
})

describe('corpoPendenciaRequisicao', () => {
  it('monta o mesmo corpo que a tela mandou: requisita o pendente, com o já requisitado e a composição calculada', () => {
    const p = corpoPendenciaRequisicao(REQUISICAO_18510)
    expect(p?.itens).toEqual([{ codigo: 'PRT706', quantidade: 498 }])
    expect(p?.numero).toBe(2)
    expect(p?.corpo).toEqual({
      ordemProducao: {
        id: '13060', tipoPropriedade: 0, numero: '8682', composicaoProduto: { item: { id: 28224 } },
        negociante: { id: '1679' }, operacaoMista: false,
      },
      numero: '2',
      itemRequisicaOrdemProducaoList: [{
        item: { id: 28258, codigo: 'PRT706', rastreavel: false }, quantidade: 498, quantidadePendente: 498,
        itemEstoqueRequisicaoList: [], itemOrdemProducaoId: 138764, motivoRequisicao: '', ordemProducaoFilha: FILHA,
        id: 141230, quantidadeRequisitadaProduto: 480, quantidadeComposicao: 978, itemFantasma: false,
      }],
      quantidade: 978, id: '18510',
    })
  })

  it('aceita a resposta com ou sem o envelope { data }', () => {
    expect(corpoPendenciaRequisicao(REQUISICAO_18510.data)?.itens).toEqual([{ codigo: 'PRT706', quantidade: 498 }])
  })

  it('nada pendente: null', () => {
    const d = REQUISICAO_18510.data
    expect(corpoPendenciaRequisicao({
      ...d, itemRequisicaOrdemProducaoList: d.itemRequisicaOrdemProducaoList.map((i) => ({ ...i, quantidadePendente: 0 })),
    })).toBeNull()
  })

  it('item RASTREÁVEL pendente: PendenciaManual (a tela pede lote/série, a integração não escolhe)', () => {
    const d = REQUISICAO_18510.data
    const rastreavel = {
      ...d,
      itemRequisicaOrdemProducaoList: [{ ...d.itemRequisicaOrdemProducaoList[0], item: { id: 28258, codigo: 'PRT706', rastreavel: true } }],
    }
    expect(() => corpoPendenciaRequisicao(rastreavel)).toThrow(PendenciaManual)
    expect(() => corpoPendenciaRequisicao(rastreavel)).toThrow(/PRT706/)
  })
})
