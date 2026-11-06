import { describe, expect, it } from 'vitest'
import { LIMITE_MENSAGEM } from '../mensagens'
import { textoFicha, type DadosFicha } from '../ficha-texto'

const CAIXA: DadosFicha = {
  unidade: 'caixa',
  codigo: 'CX[1][160]8682_F-PMOF52_F',
  // 05/11/2026 às 21:30 em São Paulo (UTC-3) = 06/11 00:30 UTC: o dia certo é o da fábrica.
  dataProducao: new Date('2026-11-06T00:30:00Z'),
  produto: 'FONTE DE ALIMENTACAO 12V',
  quantidadeOp: 1000,
  pmo: 'PMOF52_F',
  op: '8682_F',
  quantidadeApontada: 160,
  responsavel: 'Tiago',
}

describe('textoFicha', () => {
  it('uma linha por campo, na ordem da ficha de papel, com PMO e OP em linhas separadas', () => {
    expect(textoFicha(CAIXA).split('\n')).toEqual([
      '📋 Ficha de apontamento · OP PMOF52_F/8682_F · Caixa CX[1][160]8682_F-PMOF52_F',
      'Data de produção: 05/11/2026',
      'Produto: FONTE DE ALIMENTACAO 12V',
      'Quantidade da OP: 1.000',
      'PMO: PMOF52_F',
      'OP: 8682_F',
      'Quantidade apontada: 160',
      'Responsável: Tiago',
    ])
  })

  it('a primeira linha (o assunto do e-mail) diz sozinha a OP e o que é', () => {
    expect(textoFicha(CAIXA).split('\n')[0]).toContain('OP PMOF52_F/8682_F')
    expect(textoFicha({ ...CAIXA, unidade: 'lote', codigo: 'LOTE[03ec5112][6]' }).split('\n')[0]).toContain(
      'Lote LOTE[03ec5112][6]',
    )
  })

  it('o dia é o da fábrica (São Paulo), não o do UTC', () => {
    expect(textoFicha({ ...CAIXA, dataProducao: new Date('2026-11-06T02:59:00Z') })).toContain('Data de produção: 05/11/2026')
    expect(textoFicha({ ...CAIXA, dataProducao: new Date('2026-11-06T03:00:00Z') })).toContain('Data de produção: 06/11/2026')
  })

  it('dado ausente vira travessão e a linha continua lá', () => {
    const t = textoFicha({ ...CAIXA, dataProducao: null, quantidadeOp: null, produto: '  ', responsavel: '' })
    expect(t).toContain('Data de produção: —')
    expect(t).toContain('Produto: —')
    expect(t).toContain('Quantidade da OP: —')
    expect(t).toContain('Responsável: —')
  })

  it('produto enorme é cortado e a mensagem nunca passa do limite do Discord', () => {
    const t = textoFicha({ ...CAIXA, produto: 'X'.repeat(5000), responsavel: 'Y'.repeat(5000) })
    expect(t.length).toBeLessThanOrEqual(LIMITE_MENSAGEM)
    expect(t).toContain('PMO: PMOF52_F')
    expect(t).toContain('Quantidade apontada: 160')
  })
})
