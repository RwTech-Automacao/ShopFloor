import { describe, expect, it } from 'vitest'
import { destinoDoAmbiente, destinoDoEstoque, einterConfigurado, EstoqueNaoConfigurado } from '../config'

const EINTER = { COMPELS_ESTOQUE_EINTER_ID: '301', COMPELS_LOCACAO_EINTER_ID: '7001' }

describe('destinoDoEstoque', () => {
  it('PA é o destino de sempre (217/5314 por padrão), com ou sem EINTER configurado', () => {
    expect(destinoDoEstoque('PA', {})).toEqual({ estoqueId: 217, locacaoId: 5314 })
    expect(destinoDoEstoque('PA', EINTER)).toEqual({ estoqueId: 217, locacaoId: 5314 })
    expect(destinoDoEstoque('PA', { COMPELS_ESTOQUE_ID: '9', COMPELS_LOCACAO_ID: '8' })).toEqual(
      destinoDoAmbiente({ COMPELS_ESTOQUE_ID: '9', COMPELS_LOCACAO_ID: '8' }),
    )
  })

  it('EINTER usa só as variáveis próprias (nunca as do PA)', () => {
    expect(destinoDoEstoque('EINTER', { ...EINTER, COMPELS_ESTOQUE_ID: '9', COMPELS_LOCACAO_ID: '8' })).toEqual({
      estoqueId: 301,
      locacaoId: 7001,
    })
  })

  it('EINTER não tem valor padrão: sem as variáveis, recusa com mensagem clara', () => {
    expect(() => destinoDoEstoque('EINTER', {})).toThrow(EstoqueNaoConfigurado)
    expect(() => destinoDoEstoque('EINTER', { COMPELS_ESTOQUE_EINTER_ID: '  ', COMPELS_LOCACAO_EINTER_ID: '' })).toThrow(
      /EINTER ainda não está configurado/,
    )
  })

  it('EINTER configurado pela metade recusa dizendo o que falta', () => {
    expect(() => destinoDoEstoque('EINTER', { COMPELS_ESTOQUE_EINTER_ID: '301' })).toThrow(/falta COMPELS_LOCACAO_EINTER_ID/)
    expect(() => destinoDoEstoque('EINTER', { COMPELS_LOCACAO_EINTER_ID: '7001' })).toThrow(/falta COMPELS_ESTOQUE_EINTER_ID/)
  })

  it('valor que não é inteiro positivo é erro (como no PA)', () => {
    for (const ruim of ['abc', '0', '-3', '1.5']) {
      expect(() => destinoDoEstoque('EINTER', { ...EINTER, COMPELS_ESTOQUE_EINTER_ID: ruim })).toThrow(/inteiro positivo/)
      expect(() => destinoDoEstoque('EINTER', { ...EINTER, COMPELS_LOCACAO_EINTER_ID: ruim })).toThrow(/inteiro positivo/)
    }
  })
})

describe('einterConfigurado', () => {
  it('só é verdadeiro com as DUAS variáveis válidas', () => {
    expect(einterConfigurado({})).toBe(false)
    expect(einterConfigurado(EINTER)).toBe(true)
    expect(einterConfigurado({ COMPELS_ESTOQUE_EINTER_ID: '301' })).toBe(false)
    expect(einterConfigurado({ ...EINTER, COMPELS_ESTOQUE_EINTER_ID: 'x' })).toBe(false)
  })
})
