import { describe, it, expect } from 'vitest'
import { gerarCodigoCaixa, marcadorCaixaAberta, codigoMontagemAposentada, seqDoMarcadorCaixa, seqsReabertas, caixaDaVez, seqsEmRemontagem } from '../caixa'

describe('caixa', () => {
  it('gerarCodigoCaixa monta CX[seq][qtd]OP-PMO com colchetes literais', () => {
    expect(gerarCodigoCaixa(3, 10, '12345', 'PMO973')).toBe('CX[3][10]12345-PMO973')
    expect(gerarCodigoCaixa(10, 7, '5938', 'PMO973')).toBe('CX[10][7]5938-PMO973')
  })
  it('marcadorCaixaAberta é CX[seq]', () => {
    expect(marcadorCaixaAberta(1)).toBe('CX[1]')
    expect(marcadorCaixaAberta(12)).toBe('CX[12]')
  })

  it('codigoMontagemAposentada põe o R logo depois do CX[seq], preservando o resto', () => {
    expect(codigoMontagemAposentada('CX[7][14]8498-PMOC14', 7, 1)).toBe('CX[7]R[14]8498-PMOC14')
    expect(codigoMontagemAposentada('CX[10][7]5938-PMO973', 10, 1)).toBe('CX[10]R[7]5938-PMO973')
  })
  it('codigoMontagemAposentada numera da 2ª reprova em diante, pra não colidir com a anterior', () => {
    expect(codigoMontagemAposentada('CX[7][14]8498-PMOC14', 7, 2)).toBe('CX[7]R2[14]8498-PMOC14')
    expect(codigoMontagemAposentada('CX[7][13]8498-PMOC14', 7, 3)).toBe('CX[7]R3[13]8498-PMOC14')
  })
  it('codigoMontagemAposentada devolve o código intacto quando ele não é daquele seq', () => {
    expect(codigoMontagemAposentada('CX[9][14]8498-PMOC14', 7, 1)).toBe('CX[9][14]8498-PMOC14')
  })
})

describe('seqDoMarcadorCaixa', () => {
  it('lê o seq do marcador de caixa aberta', () => {
    expect(seqDoMarcadorCaixa('CX[1]')).toBe(1)
    expect(seqDoMarcadorCaixa(' CX[12] ')).toBe(12)
  })
  it('não confunde com o código final da caixa fechada, a montagem aposentada nem SN de embalagem individual', () => {
    expect(seqDoMarcadorCaixa('CX[3][10]12345-PMO973')).toBeNull()
    expect(seqDoMarcadorCaixa('CX[7]R[14]8498-PMOC14')).toBeNull()
    expect(seqDoMarcadorCaixa('SN00123')).toBeNull()
    expect(seqDoMarcadorCaixa('')).toBeNull()
  })
})

describe('seqsReabertas', () => {
  const cx = (seq: number, fechada: boolean, revisao = 0) => ({ seq, fechada, revisao })

  it('caixa aberta lá atrás, por cancelamento, aparece como reaberta; a da vez não', () => {
    expect(seqsReabertas([cx(1, false), cx(2, true), cx(3, false)], 3)).toEqual([1])
  })
  it('sem nenhuma aberta fora da da vez: nenhuma reaberta', () => {
    expect(seqsReabertas([cx(1, true), cx(2, true), cx(3, false)], 3)).toEqual([])
  })
  it('REMONTAGEM não é reaberta: o seq com montagem aposentada fica fora, mesmo aberto', () => {
    expect(seqsReabertas([cx(7, true, 1), cx(7, false), cx(8, false)], 8)).toEqual([])
  })
  it('remontagem com bipe cancelado continua sendo remontagem', () => {
    expect(seqsReabertas([cx(7, true, 1), cx(7, false), cx(9, true), cx(10, false)], 10)).toEqual([])
  })
  it('montagem aposentada (histórico) nunca aparece, nem aberta', () => {
    expect(seqsReabertas([cx(4, false, 1), cx(5, false)], 5)).toEqual([])
  })
  it('várias reabertas saem em ordem', () => {
    expect(seqsReabertas([cx(3, false), cx(1, false), cx(2, true), cx(4, false)], 4)).toEqual([1, 3])
  })
  it('OP concluída (a da vez é a última, fechada): a reaberta lá atrás continua aparecendo', () => {
    expect(seqsReabertas([cx(1, false), cx(2, true)], 2)).toEqual([1])
  })
})

describe('caixaDaVez', () => {
  const cx = (seq: number, fechada: boolean, revisao = 0, ultima = false) => ({ seq, fechada, revisao, ultima })

  it('sem caixa nenhuma: a CX1, ainda por abrir', () => {
    expect(caixaDaVez([])).toEqual({ seq: 1, aberta: false })
  })
  it('a caixa aberta de maior número é a da vez', () => {
    expect(caixaDaVez([cx(1, true), cx(2, false)])).toEqual({ seq: 2, aberta: true })
  })
  it('última fechada (sem ser a última da OP): a da vez é a próxima', () => {
    expect(caixaDaVez([cx(1, true), cx(2, true)])).toEqual({ seq: 3, aberta: false })
  })
  it('CX1 fechada e REABERTA por cancelamento com a CX2 aberta: a da vez continua a CX2', () => {
    const caixas = [cx(1, false), cx(2, false)]
    expect(caixaDaVez(caixas)).toEqual({ seq: 2, aberta: true })
    expect(seqsReabertas(caixas, 2)).toEqual([1])
    expect(seqsEmRemontagem(caixas)).toEqual([])
  })
  it('smoke 17/09: CX1 reaberta e CX2 reprovada no NQA (sem remontagem começada) → da vez é a CX3, não a CX1', () => {
    const caixas = [cx(1, false), cx(2, true, 1)]
    expect(caixaDaVez(caixas)).toEqual({ seq: 3, aberta: false })
    expect(seqsReabertas(caixas, 3)).toEqual([1])
    expect(seqsEmRemontagem(caixas)).toEqual([2])
  })
  it('remontagem da última caixa já começada não vira a caixa da vez (o número está reservado)', () => {
    const caixas = [cx(1, false), cx(2, true, 1), cx(2, false)]
    expect(caixaDaVez(caixas)).toEqual({ seq: 3, aberta: false })
    expect(seqsReabertas(caixas, 3)).toEqual([1])
    expect(seqsEmRemontagem(caixas)).toEqual([2])
  })
  it('remontagem de caixa antiga com a da vez aberta: nada muda', () => {
    const caixas = [cx(7, true, 1), cx(7, false), cx(8, false)]
    expect(caixaDaVez(caixas)).toEqual({ seq: 8, aberta: true })
    expect(seqsEmRemontagem(caixas)).toEqual([7])
    expect(seqsReabertas(caixas, 8)).toEqual([])
  })
  it('remontagem já fechada sai da lista de remontagens', () => {
    expect(seqsEmRemontagem([cx(7, true, 1), cx(7, true), cx(8, false)])).toEqual([])
  })
  it('última caixa da OP fechada e nenhuma remontagem pendente: concluída (null), mesmo com reaberta lá atrás', () => {
    expect(caixaDaVez([cx(1, false), cx(2, true, 0, true)])).toBeNull()
  })
  it('remontagem pendente reabre o trabalho: não está concluída', () => {
    expect(caixaDaVez([cx(1, true), cx(2, true, 0, true), cx(3, true, 1)])).toEqual({ seq: 4, aberta: false })
  })
})
