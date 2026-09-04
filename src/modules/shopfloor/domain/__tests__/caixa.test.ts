import { describe, it, expect } from 'vitest'
import { gerarCodigoCaixa, marcadorCaixaAberta, seqDoMarcadorCaixa, derivarEstadoCaixas, type LinhaCaixa } from '../caixa'

describe('caixa', () => {
  it('gerarCodigoCaixa monta CX[seq][qtd]OP-PMO com colchetes literais', () => {
    expect(gerarCodigoCaixa(3, 10, '12345', 'PMO973')).toBe('CX[3][10]12345-PMO973')
    expect(gerarCodigoCaixa(10, 7, '5938', 'PMO973')).toBe('CX[10][7]5938-PMO973')
  })
  it('marcadorCaixaAberta é CX[seq]', () => {
    expect(marcadorCaixaAberta(1)).toBe('CX[1]')
    expect(marcadorCaixaAberta(12)).toBe('CX[12]')
  })
})

describe('seqDoMarcadorCaixa', () => {
  it('lê o seq do marcador de caixa aberta', () => {
    expect(seqDoMarcadorCaixa('CX[1]')).toBe(1)
    expect(seqDoMarcadorCaixa(' CX[12] ')).toBe(12)
  })
  it('não confunde com o código final da caixa fechada nem com SN de embalagem individual', () => {
    expect(seqDoMarcadorCaixa('CX[3][10]12345-PMO973')).toBeNull()
    expect(seqDoMarcadorCaixa('SN00123')).toBeNull()
    expect(seqDoMarcadorCaixa('')).toBeNull()
  })
})

describe('derivarEstadoCaixas', () => {
  const cx = (seq: number, fechada: boolean, ultima = false, limite = 10): LinhaCaixa =>
    ({ seq, limite, fechada, ultima })

  it('sem caixa nenhuma: começa na 1 e o limite ainda não foi definido', () => {
    expect(derivarEstadoCaixas([])).toEqual({
      seq: 1, limite: null, atualAberta: false, concluida: false, reabertas: [],
    })
  })
  it('última aberta é a caixa atual', () => {
    const d = derivarEstadoCaixas([cx(1, true), cx(2, false)])
    expect(d.seq).toBe(2)
    expect(d.atualAberta).toBe(true)
    expect(d.reabertas).toEqual([])
  })
  it('última fechada: a atual é a PRÓXIMA (ainda não existe em sf_caixas)', () => {
    const d = derivarEstadoCaixas([cx(1, true), cx(2, true)])
    expect(d.seq).toBe(3)
    expect(d.atualAberta).toBe(false)
    expect(d.limite).toBe(10) // limite é digitado uma vez e vale pras próximas
  })
  it('caixa reaberta por cancelamento não toma o lugar da caixa que está sendo enchida', () => {
    const d = derivarEstadoCaixas([cx(1, false), cx(2, true), cx(3, false)])
    expect(d.seq).toBe(3)          // a atual continua sendo a de maior seq
    expect(d.atualAberta).toBe(true)
    expect(d.reabertas.map((c) => c.seq)).toEqual([1])
  })
  it('reabrir a caixa de maior seq faz ela virar a atual (não há outra sendo enchida)', () => {
    const d = derivarEstadoCaixas([cx(1, true), cx(2, false)])
    expect(d.seq).toBe(2)
    expect(d.reabertas).toEqual([])
  })
  it('OP concluída continua concluída, mas a reaberta aparece pendente', () => {
    const d = derivarEstadoCaixas([cx(1, false), cx(2, true, true)])
    expect(d.concluida).toBe(true)
    expect(d.reabertas.map((c) => c.seq)).toEqual([1])
  })
  it('última fechada sem ser marcada como última: não concluiu', () => {
    expect(derivarEstadoCaixas([cx(1, true)]).concluida).toBe(false)
  })
  it('mais de uma reaberta ao mesmo tempo', () => {
    const d = derivarEstadoCaixas([cx(1, false), cx(2, false), cx(3, true), cx(4, false)])
    expect(d.seq).toBe(4)
    expect(d.reabertas.map((c) => c.seq)).toEqual([1, 2])
  })
})
