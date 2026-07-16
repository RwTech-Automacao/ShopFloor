import { describe, expect, it } from 'vitest'
import { aplicarPadrao, nomePadraoValido } from '../padrao-importacao'
import type { CampoImportavel } from '../mapeamento'

const campo = (campo: string, rotulo: string): CampoImportavel => ({
  campo,
  rotulo,
  tipo: 'texto',
  listaChave: null,
  obrigatorioImportacao: false,
})

const CAMPOS: CampoImportavel[] = [
  campo('codigo_material', 'Código'),
  campo('numero_nf', 'Nº NF'),
  campo('numero_pedido', 'Pedido'),
]

describe('aplicarPadrao', () => {
  it('casa por nome exato', () => {
    const r = aplicarPadrao({ codigo_material: 'Part Number' }, ['Part Number', 'Qtd'], CAMPOS)
    expect(r.mapeamento).toEqual({ codigo_material: 'Part Number' })
    expect(r.colunasNaoEncontradas).toEqual([])
  })

  it('casa por nome normalizado e usa o nome REAL da coluna atual', () => {
    // padrão salvou 'Nº NF'; a planilha atual traz 'N NF' (sem acento/símbolo)
    const r = aplicarPadrao({ numero_nf: 'Nº NF' }, ['N NF'], CAMPOS)
    expect(r.mapeamento).toEqual({ numero_nf: 'N NF' })
    expect(r.colunasNaoEncontradas).toEqual([])
  })

  it('coluna salva ausente na planilha atual entra em colunasNaoEncontradas', () => {
    const r = aplicarPadrao({ numero_pedido: 'Pedido Compra' }, ['Outra'], CAMPOS)
    expect(r.mapeamento).toEqual({})
    expect(r.colunasNaoEncontradas).toEqual(['Pedido Compra'])
  })

  it('descarta campo desativado sem marcá-lo como não encontrado', () => {
    // 'campo_zumbi' não está em CAMPOS (foi desativado no catálogo)
    const r = aplicarPadrao(
      { campo_zumbi: 'Alguma', codigo_material: 'Código' },
      ['Código', 'Alguma'],
      CAMPOS,
    )
    expect(r.mapeamento).toEqual({ codigo_material: 'Código' })
    expect(r.colunasNaoEncontradas).toEqual([])
  })

  it('padrão vazio → mapeamento vazio', () => {
    expect(aplicarPadrao({}, ['Código'], CAMPOS)).toEqual({
      mapeamento: {},
      colunasNaoEncontradas: [],
    })
  })

  it('não muta as entradas', () => {
    const salvo = { codigo_material: 'Código' }
    const cols = ['Código']
    aplicarPadrao(salvo, cols, CAMPOS)
    expect(salvo).toEqual({ codigo_material: 'Código' })
    expect(cols).toEqual(['Código'])
  })
})

describe('nomePadraoValido', () => {
  it('vazio ou só espaços → false', () => {
    expect(nomePadraoValido('')).toBe(false)
    expect(nomePadraoValido('   ')).toBe(false)
  })
  it('com conteúdo → true', () => {
    expect(nomePadraoValido('Fornecedor X')).toBe(true)
  })
})
