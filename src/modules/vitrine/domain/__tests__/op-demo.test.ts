import { describe, expect, it } from 'vitest'
import { MANUTENCAO, SAIDA, ENTRADA } from '@/modules/shopfloor/domain/fluxo-op'
import {
  QTD_DEMO, T_INICIO_LACO, T_FIM_LACO, NOMES_POSTOS, PECAS_POR_CAIXA,
  bipesAte, resumir, fluxoDemo, burninDemo, pendentesPorPeca, snDaPeca, caixaDaPeca,
} from '../op-demo'

const iso = (m: number) => new Date(Date.UTC(2026, 10, 9, 10) + m * 60000).toISOString()

describe('OP da vitrine', () => {
  it('no começo do laço está em torno de 93% e no fim em torno de 97%', () => {
    const ini = resumir(T_INICIO_LACO, iso)
    const fim = resumir(T_FIM_LACO, iso)
    expect(ini.finalizadas / QTD_DEMO).toBeGreaterThan(0.91)
    expect(ini.finalizadas / QTD_DEMO).toBeLessThan(0.95)
    expect(fim.finalizadas / QTD_DEMO).toBeGreaterThan(0.95)
    expect(fim.finalizadas).toBeLessThan(QTD_DEMO)
  })

  it('a conta fecha: fila de todos os postos + finalizadas + não iniciadas = qtd da OP', () => {
    for (const t of [0, 500, T_INICIO_LACO, T_FIM_LACO]) {
      const r = resumir(t, iso)
      const fila = r.agregados.reduce((s, a) => s + a.wip, 0)
      // as não iniciadas entram na fila do 1º posto (como no Fluxo real) → não somar de novo
      expect(fila + r.finalizadas).toBe(QTD_DEMO)
    }
  })

  it('nenhuma reprova, nenhuma peça na Manutenção', () => {
    const r = resumir(T_FIM_LACO, iso)
    expect(r.agregados.every((a) => a.reprovadas === 0 && a.reprovadosSemReteste === 0)).toBe(true)
    expect(r.agregados.find((a) => a.posto === MANUTENCAO)?.wip).toBe(0)
    expect(bipesAte(T_FIM_LACO).every((b) => b.status !== 'Reprovado')).toBe(true)
  })

  it('o canvas tem os 11 postos + Entrada, Saída e Manutenção, sem aresta de reprova', () => {
    const { nodes, edges } = fluxoDemo(T_INICIO_LACO, iso)
    const ids = nodes.map((n) => n.id)
    // Almoxarifado no fim da rota vira o card Saída (Finalizadas).
    for (const p of NOMES_POSTOS.slice(0, -1)) expect(ids).toContain(p)
    expect(ids).toEqual(expect.arrayContaining([ENTRADA, SAIDA, MANUTENCAO]))
    expect(edges.some((e) => e.tipo === 'reprova')).toBe(false)
    const saida = nodes.find((n) => n.id === SAIDA)!
    expect(saida.data.wip).toBe(resumir(T_INICIO_LACO, iso).finalizadas)
  })

  it('as peças andam: entre dois instantes do laço há mais finalizadas', () => {
    expect(resumir(T_INICIO_LACO + 30, iso).finalizadas).toBeGreaterThan(resumir(T_INICIO_LACO, iso).finalizadas)
  })

  it('peça concluída passou por todos os postos; caixas de 50', () => {
    const pend = pendentesPorPeca(T_INICIO_LACO)
    expect(pend.get(snDaPeca(0))).toBeNull()
    expect(caixaDaPeca(0)).toBe('CX[1]')
    expect(caixaDaPeca(PECAS_POR_CAIXA)).toBe('CX[2]')
    const almox = resumir(T_INICIO_LACO, iso).agregados.find((a) => a.posto === 'Almoxarifado')!
    expect(almox.caixasFechadas).toBeGreaterThanOrEqual(almox.caixasBipadas!)
  })

  it('burn-in: peças cozinhando têm entrada sem saída', () => {
    const b = burninDemo(T_INICIO_LACO, 'Burn-in', iso)
    expect(b.emAndamento.length).toBeGreaterThan(0)
    expect(b.entradas.length).toBe(b.saidas.length + b.emAndamento.length)
  })

  it('é determinístico', () => {
    expect(JSON.stringify(resumir(T_INICIO_LACO, iso))).toBe(JSON.stringify(resumir(T_INICIO_LACO, iso)))
  })
})
