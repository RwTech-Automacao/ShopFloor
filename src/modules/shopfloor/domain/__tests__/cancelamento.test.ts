import { describe, it, expect } from 'vitest'
import { postoCancelavel, ehEntradaDeCaixaAlmoxarifado } from '../cancelamento'

describe('postoCancelavel', () => {
  it('bloqueia postos com efeito colateral que o cancelamento não sabe desfazer', () => {
    expect(postoCancelavel('nqa')).toBe(false)
    expect(postoCancelavel('integracao')).toBe(false)
  })
  it('permite postos que só vivem em sf_registros', () => {
    expect(postoCancelavel('nenhum')).toBe(true)
    expect(postoCancelavel('burnin')).toBe(true)
  })
  it('permite embalagem: a RPC (0106) tira a peça da caixa e reabre a caixa fechada', () => {
    expect(postoCancelavel('caixa')).toBe(true)
  })
  it('permite quando o recurso é desconhecido/nulo', () => {
    expect(postoCancelavel(null)).toBe(true)
    expect(postoCancelavel(undefined)).toBe(true)
    expect(postoCancelavel('')).toBe(true)
  })
})

describe('ehEntradaDeCaixaAlmoxarifado', () => {
  it('entrada de caixa no Almoxarifado: o desfazer é a caixa inteira', () => {
    // Um bipe do código da caixa gravou uma linha por peça (0129) — então a tela oferece
    // "cancelar a caixa inteira" (0131), não "cancelar este bipe".
    expect(ehEntradaDeCaixaAlmoxarifado('almoxarifado', 'CX[3][14]8498-PMOC14')).toBe(true)
  })
  it('entrada de OP individual (sem código de caixa) segue no cancelamento comum', () => {
    // Já é uma peça, um bipe, uma linha. E numero_caixa vazio casaria com TODAS as entradas
    // individuais do posto, então aqui a resposta tem que ser não.
    expect(ehEntradaDeCaixaAlmoxarifado('almoxarifado', '')).toBe(false)
    expect(ehEntradaDeCaixaAlmoxarifado('almoxarifado', '   ')).toBe(false)
    expect(ehEntradaDeCaixaAlmoxarifado('almoxarifado', null)).toBe(false)
  })
  it('caixa da EMBALAGEM não é entrada de caixa: lá o cancelamento reabre a caixa', () => {
    expect(ehEntradaDeCaixaAlmoxarifado('caixa', 'CX[3][14]8498-PMOC14')).toBe(false)
  })
  it('recurso desconhecido/nulo não vira entrada de caixa (fail-closed)', () => {
    expect(ehEntradaDeCaixaAlmoxarifado(null, 'CX[3][14]8498-PMOC14')).toBe(false)
    expect(ehEntradaDeCaixaAlmoxarifado(undefined, 'CX[3][14]8498-PMOC14')).toBe(false)
    expect(ehEntradaDeCaixaAlmoxarifado('nenhum', 'CX[3][14]8498-PMOC14')).toBe(false)
  })
})
