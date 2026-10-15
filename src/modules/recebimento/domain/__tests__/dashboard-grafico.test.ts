import { describe, expect, it } from 'vitest'
import { ALTURA_GRAFICO, eixoInteiro, geometriaSemanas, passoRedondo } from '../dashboard-grafico'
import type { SemanaDashboard } from '../dashboard'

const s = (inicio: string, justificadas: number, semJustificativa: number): SemanaDashboard =>
  ({ inicio, justificadas, semJustificativa })

describe('eixo Y', () => {
  it('passo redondo e inteiro', () => {
    expect(passoRedondo(1)).toBe(1)
    expect(passoRedondo(7)).toBe(2)
    expect(passoRedondo(10)).toBe(5)
    expect(passoRedondo(137)).toBe(50)
  })
  it('o topo é a última marca e cobre o maior valor', () => {
    expect(eixoInteiro(7)).toEqual({ topo: 8, marcas: [0, 2, 4, 6, 8] })
    expect(eixoInteiro(4)).toEqual({ topo: 4, marcas: [0, 1, 2, 3, 4] })
    expect(eixoInteiro(137)).toEqual({ topo: 150, marcas: [0, 50, 100, 150] })
    expect(eixoInteiro(1500)).toEqual({ topo: 1500, marcas: [0, 500, 1000, 1500] })
  })
  it('tudo zero ainda tem um eixo de 0 a 1 (sem divisão por zero)', () => {
    expect(eixoInteiro(0)).toEqual({ topo: 1, marcas: [0, 1] })
  })
})

describe('geometriaSemanas', () => {
  const semanas = [s('2026-09-07', 1, 1), s('2026-09-14', 0, 0), s('2026-09-21', 1, 3)]
  const g = geometriaSemanas(semanas, 640)

  it('UMA escala: a marca "4" está na altura do topo da barra que soma 4', () => {
    const marca4 = g.marcas.find((m) => m.valor === 4)!
    expect(g.barras[2]!.ySem).toBeCloseTo(marca4.y, 6)
    const marca0 = g.marcas.find((m) => m.valor === 0)!
    expect(marca0.y).toBeCloseTo(g.basePlot, 6)
  })
  it('as barras empilham: justificadas embaixo, sem justificativa em cima, na base do eixo', () => {
    const b = g.barras[0]!
    expect(b.yJustificadas + b.alturaJustificadas).toBeCloseTo(g.basePlot, 6)
    expect(b.ySem + b.alturaSem).toBeCloseTo(b.yJustificadas, 6)
    expect(b.alturaJustificadas).toBeCloseTo(b.alturaSem, 6) // 1 e 1
  })
  it('semana vazia tem altura zero, mas está lá (o eixo não pula semana)', () => {
    expect(g.barras).toHaveLength(3)
    expect(g.barras[1]!.alturaJustificadas).toBe(0)
    expect(g.barras[1]!.alturaSem).toBe(0)
  })
  it('tudo cabe na largura e na altura do SVG', () => {
    for (const b of g.barras) {
      expect(b.x).toBeGreaterThanOrEqual(g.esquerda)
      expect(b.x + b.largura).toBeLessThanOrEqual(g.direita + 1e-6)
      expect(b.ySem).toBeGreaterThanOrEqual(g.topoPlot - 1e-6)
    }
    expect(g.altura).toBe(ALTURA_GRAFICO)
    expect(g.direita).toBeLessThan(g.largura)
  })
  it('uma semana só: uma barra centrada, larga no máximo 32 px', () => {
    const um = geometriaSemanas([s('2026-09-21', 2, 0)], 640)
    expect(um.barras).toHaveLength(1)
    expect(um.barras[0]!.largura).toBe(32)
    expect(um.barras[0]!.centro).toBeCloseTo((um.esquerda + um.direita) / 2, 6)
    expect(um.barras[0]!.rotulo).toBe('21/09')
  })
  it('muitas semanas: rótulos pulam para não encavalar (≥ 44 px entre eles)', () => {
    const muitas = Array.from({ length: 52 }, (_, i) => s(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 1, 0))
    const gm = geometriaSemanas(muitas, 360)
    const comRotulo = gm.barras.filter((b) => b.rotulo !== null)
    expect(comRotulo.length).toBeGreaterThan(1)
    for (let i = 1; i < comRotulo.length; i++) {
      expect(comRotulo[i]!.centro - comRotulo[i - 1]!.centro).toBeGreaterThanOrEqual(44 - 1e-6)
    }
  })
  it('a margem esquerda cresce com o tamanho do maior rótulo do eixo', () => {
    const pequeno = geometriaSemanas([s('2026-09-21', 3, 0)], 640)
    const grande = geometriaSemanas([s('2026-09-21', 1400, 0)], 640)
    expect(grande.esquerda).toBeGreaterThan(pequeno.esquerda)
  })
  it('largura mínima de 280 px (celular estreito)', () => {
    expect(geometriaSemanas(semanas, 200).largura).toBe(280)
  })
})
