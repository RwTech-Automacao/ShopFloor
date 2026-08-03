import { describe, it, expect } from 'vitest'
import { gerarCodigoCaixa, marcadorCaixaAberta } from '../caixa'

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
