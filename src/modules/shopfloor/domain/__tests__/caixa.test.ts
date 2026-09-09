import { describe, it, expect } from 'vitest'
import { gerarCodigoCaixa, marcadorCaixaAberta, codigoMontagemAposentada } from '../caixa'

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
