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
  it('ligado: opacity-0 + volta no hover DO PRÓPRIO controle e no foco', () => {
    const c = classeSoNoHover(true)
    expect(c).toBe(CLASSE_SO_NO_HOVER)
    expect(c).toContain('opacity-0')
    expect(c).toContain('hover:opacity-100')
    expect(c).toContain('focus-within:opacity-100')
  })
  // A regressão que o usuário pegou em produção (09/10): com o hover no canvas inteiro, em Modo
  // TV o canvas ocupa a tela toda e os três ficavam SEMPRE visíveis. Este teste morre se alguém
  // devolver o gatilho para o canvas.
  it('o gatilho NÃO é o canvas (senão o mouse em qualquer lugar da tela mostra os três)', () => {
    expect(classeSoNoHover(true)).not.toContain('group-hover/canvas')
  })
  // Sem isto o controle invisível não receberia o ponteiro e o hover nunca aconteceria — os três
  // sumiriam de vez no Modo TV, inalcançáveis até no PC.
  it('ligado: o invisível volta a receber o ponteiro onde existe hover', () => {
    const c = classeSoNoHover(true)
    expect(c).toContain('pointer-events-none')
    expect(c).toContain('[@media(hover:hover)]:pointer-events-auto')
  })
})
