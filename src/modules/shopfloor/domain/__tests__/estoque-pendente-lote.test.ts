import { describe, it, expect } from 'vitest'
import { rotuloTipoGrupo, type GrupoEstoquePendente, type LinhaEstoquePendente } from '../estoque-pendente'

function grupo(tipo: GrupoEstoquePendente['tipo'], linhas: Partial<LinhaEstoquePendente>[] = []): GrupoEstoquePendente {
  return {
    id: 'g', pmo: 'PMOL01', op: '9201', posto: 'Almoxarifado', alvo: 'LOTE[abcd1234][5]', tipo,
    linhas: linhas as LinhaEstoquePendente[],
  }
}

describe('rotuloTipoGrupo (0156: envio de lote)', () => {
  it('caixa e peça continuam como antes', () => {
    expect(rotuloTipoGrupo(grupo('caixa'))).toBe('caixa')
    expect(rotuloTipoGrupo(grupo('serie'))).toBe('peça')
  })

  it('lote diz que é lote do NQA e quantas peças a entrada levou', () => {
    expect(rotuloTipoGrupo(grupo('lote', [{ operacao: 'entrada', quantidade: 5 }]))).toBe('lote do NQA · 5 peças')
    expect(rotuloTipoGrupo(grupo('lote', [{ operacao: 'entrada', quantidade: 1 }]))).toBe('lote do NQA · 1 peça')
  })

  it('lote só com o estorno na tela: a quantidade vem do estorno', () => {
    expect(rotuloTipoGrupo(grupo('lote', [{ operacao: 'estorno', quantidade: 3 }]))).toBe('lote do NQA · 3 peças')
  })

  it('lote sem linha: só "lote do NQA"', () => {
    expect(rotuloTipoGrupo(grupo('lote'))).toBe('lote do NQA')
  })
})
