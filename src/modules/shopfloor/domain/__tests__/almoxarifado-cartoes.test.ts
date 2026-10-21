import { describe, it, expect } from 'vitest'
import {
  FRASE_CAIXA_ERRADA,
  chaveDaOp,
  codigoConfere,
  filtrarPorOp,
  horaCurta,
  quandoCurto,
  opsComPendencia,
  type PendenciaAlmoxarifado,
} from '../almoxarifado'

function pend(op: string, pmo: string, codigo = 'X'): PendenciaAlmoxarifado {
  return { pmo, op, tipo: 'caixa', codigo, pecas: 1, amostra: null, loteId: null, em: null }
}

describe('opsComPendencia', () => {
  it('agrupa pendências da mesma OP e ordena numericamente', () => {
    const itens = [pend('10001', 'PMOA'), pend('9950', 'PMOA'), pend('9901', 'PMOB', 'a'), pend('9901', 'PMOB', 'b')]
    expect(opsComPendencia(itens)).toEqual([
      { chave: '9901 · PMOB', pmo: 'PMOB', op: '9901' },
      { chave: '9950 · PMOA', pmo: 'PMOA', op: '9950' },
      { chave: '10001 · PMOA', pmo: 'PMOA', op: '10001' },
    ])
  })
  it('chaveDaOp usa "op · pmo"', () => {
    expect(chaveDaOp({ pmo: 'PMOT02', op: '9901' })).toBe('9901 · PMOT02')
  })
})

describe('filtrarPorOp', () => {
  const itens = [pend('9901', 'PMOB'), pend('9950', 'PMOA')]
  it('null devolve tudo', () => expect(filtrarPorOp(itens, null)).toEqual(itens))
  it('com chave devolve só a OP', () => expect(filtrarPorOp(itens, '9950 · PMOA')).toEqual([itens[1]]))
})

describe('horaCurta', () => {
  it('converte para HH:MM de São Paulo', () => expect(horaCurta('2026-10-21T13:42:00Z')).toBe('10:42'))
  it('nulo ou inválido vira vazio', () => {
    expect(horaCurta(null)).toBe('')
    expect(horaCurta('lixo')).toBe('')
  })
})

describe('quandoCurto', () => {
  const agora = new Date('2026-10-21T18:00:00Z') // 15:00 em São Paulo
  it('do dia: "hoje HH:MM"', () => expect(quandoCurto('2026-10-21T15:30:00Z', agora)).toBe('hoje 12:30'))
  it('de ontem: "dd/mm HH:MM"', () => expect(quandoCurto('2026-10-20T18:30:00Z', agora)).toBe('20/10 15:30'))
  it('vira o dia em São Paulo, não em UTC', () => {
    // 21/10 01:00Z ainda é 20/10 22:00 em São Paulo
    expect(quandoCurto('2026-10-21T01:00:00Z', agora)).toBe('20/10 22:00')
  })
  it('nulo ou inválido vira vazio', () => {
    expect(quandoCurto(null, agora)).toBe('')
    expect(quandoCurto('lixo', agora)).toBe('')
  })
})

describe('codigoConfere', () => {
  it('ignora espaços e caixa', () => expect(codigoConfere(' cx[2][2]9901-pmot02 ', 'CX[2][2]9901-PMOT02')).toBe(true))
  it('códigos diferentes não conferem', () => expect(codigoConfere('CX[3][2]9901-PMOT02', 'CX[2][2]9901-PMOT02')).toBe(false))
  it('frase da caixa errada', () => expect(FRASE_CAIXA_ERRADA).toBe('Este não é o código desta caixa. Confira a caixa na mão.'))
})
