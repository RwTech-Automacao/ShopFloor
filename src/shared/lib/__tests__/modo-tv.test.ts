import { describe, it, expect } from 'vitest'
import { lerModoTv, controlesSoNoHover, classeSoNoHover, CLASSE_SO_NO_HOVER } from '../modo-tv'

describe('lerModoTv', () => {
  it('só "tv" liga o modo', () => {
    expect(lerModoTv('tv')).toBe(true)
  })
  it('ausente, vazio ou outro valor: desligado', () => {
    expect(lerModoTv(undefined)).toBe(false)
    expect(lerModoTv('')).toBe(false)
    expect(lerModoTv('TV')).toBe(false)
    expect(lerModoTv('1')).toBe(false)
    expect(lerModoTv('true')).toBe(false)
  })
  it('parâmetro repetido (?modo=tv&modo=x) usa o primeiro, como o resto da app', () => {
    expect(lerModoTv(['tv', 'x'])).toBe(true)
    expect(lerModoTv(['x', 'tv'])).toBe(false)
    expect(lerModoTv([])).toBe(false)
  })
})

// Decisão de produto (spec, "Os três controles"): esconde no embed (com ou sem ?modo=tv) OU em
// Modo TV. Só a tela normal fora do Modo TV fica de fora, porque o tablet não tem hover.
// Assinatura: controlesSoNoHover(emEmbed, emModoTv).
describe('controlesSoNoHover', () => {
  it('embed sem ?modo=tv: esconde (só no hover)', () => {
    expect(controlesSoNoHover(true, false)).toBe(true)
  })
  it('embed com ?modo=tv: esconde (só no hover)', () => {
    expect(controlesSoNoHover(true, true)).toBe(true)
  })
  it('tela normal em Modo TV (tela cheia do navegador): esconde (só no hover)', () => {
    expect(controlesSoNoHover(false, true)).toBe(true)
  })
  // A ÚNICA combinação que fica visível — protege o tablet, que não tem hover.
  it('tela normal fora do Modo TV: NÃO esconde, controles sempre visíveis (tablet)', () => {
    expect(controlesSoNoHover(false, false)).toBe(false)
  })
})

describe('classeSoNoHover', () => {
  it('desligado: string vazia (a tela normal não ganha classe nenhuma)', () => {
    expect(classeSoNoHover(false)).toBe('')
  })
  it('ligado: opacity-0 + volta no hover do canvas e no foco', () => {
    const c = classeSoNoHover(true)
    expect(c).toBe(CLASSE_SO_NO_HOVER)
    expect(c).toContain('opacity-0')
    expect(c).toContain('group-hover/canvas:opacity-100')
    expect(c).toContain('focus-within:opacity-100')
  })
})
