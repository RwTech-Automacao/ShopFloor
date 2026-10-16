import { describe, expect, it } from 'vitest'
import { estadoDaOp } from '../estado-op'
import { leiturasDeRespostas, listaDe, RespostaInesperada } from '../leituras-erp'

// Formato real observado em 16/10/2026 (OP 8697, 10 un.), só com os campos que a integração lê.
const emp = (quantidade: number) => ({ quantidade, quantidadeEstornar: 0, quantidadeEmpenhada: 0 })
const apont = (quantidadeProduzida: number) => ({ quantidadeProduzida, quantidadeCancelada: 0 })

const OP_8697 = {
  op: { data: { id: 13075, numero: 8697, status: 'Produzida', tipoPropriedade: 0, quantidade: 10 } },
  empenhos: [emp(4), emp(1), emp(5)], // GET empenho/findByOrdemProducaoId: lista direta
  requisicoes: { data: [emp(4), emp(1), emp(5)], success: true }, // POST requisicao...: { data }
  apontamentos: { data: [apont(4), apont(1), apont(3), apont(2)], success: true },
}

describe('leiturasDeRespostas', () => {
  it('lê a OP 8697 inteira e o estado bate: 10/10/10 (contadores zerados das listas são ignorados)', () => {
    const estado = estadoDaOp(leiturasDeRespostas(OP_8697))
    expect(estado).toMatchObject({ empenhada: 10, requisitada: 10, apontada: 10, quantidadeOp: 10, tipoPropriedade: 0 })
  })

  it('aceita a OP sem o embrulho `data`', () => {
    const l = leiturasDeRespostas({ ...OP_8697, op: OP_8697.op.data })
    expect(l.status).toBe('Produzida')
  })

  it('OP sem nada feito: listas vazias dão zero (e isso é legítimo, não é erro)', () => {
    const l = leiturasDeRespostas({ ...OP_8697, empenhos: [], requisicoes: { data: [] }, apontamentos: { data: [] } })
    expect(estadoDaOp(l)).toMatchObject({ empenhada: 0, requisitada: 0, apontada: 0 })
  })

  it('campo numérico ausente vira RespostaInesperada, nunca zero', () => {
    const semQuantidade = { ...OP_8697, apontamentos: { data: [{ quantidadeCancelada: 0 }] } }
    expect(() => leiturasDeRespostas(semQuantidade)).toThrow(RespostaInesperada)
  })

  it('campo numérico como texto vira RespostaInesperada', () => {
    const texto = { ...OP_8697, empenhos: [{ quantidade: '4', quantidadeEstornar: 0 }] }
    expect(() => leiturasDeRespostas(texto)).toThrow(RespostaInesperada)
  })

  it('OP sem status ou tipoPropriedade vira RespostaInesperada', () => {
    expect(() => leiturasDeRespostas({ ...OP_8697, op: { data: { quantidade: 10, tipoPropriedade: 0 } } })).toThrow(RespostaInesperada)
    expect(() => leiturasDeRespostas({ ...OP_8697, op: { data: { status: 'x', quantidade: 10 } } })).toThrow(RespostaInesperada)
  })
})

describe('listaDe', () => {
  it('aceita lista direta, { data } e { results }', () => {
    expect(listaDe([{ a: 1 }], 'x')).toHaveLength(1)
    expect(listaDe({ data: [{ a: 1 }] }, 'x')).toHaveLength(1)
    expect(listaDe({ results: [{ a: 1 }] }, 'x')).toHaveLength(1)
  })

  it('recusa o que não é lista', () => {
    expect(() => listaDe({ data: {} }, 'x')).toThrow(RespostaInesperada)
    expect(() => listaDe(null, 'x')).toThrow(RespostaInesperada)
    expect(() => listaDe([1], 'x')).toThrow(RespostaInesperada)
  })
})
