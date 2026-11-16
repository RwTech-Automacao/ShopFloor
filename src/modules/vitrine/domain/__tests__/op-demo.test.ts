import { describe, expect, it } from 'vitest'
import { MANUTENCAO, SAIDA, ENTRADA } from '@/modules/shopfloor/domain/fluxo-op'
import {
  QTD_DEMO, T_INICIO_LACO, T_FIM_LACO, NOMES_POSTOS, PECAS_POR_CAIXA,
  bipesAte, resumir, fluxoDemo, burninDemo, pendentesPorPeca, snDaPeca, caixaDaPeca,
} from '../op-demo'

const iso = (m: number) => new Date(Date.UTC(2026, 10, 9, 10) + m * 60000).toISOString()

describe('OP da vitrine', () => {
  it('no começo do laço está em torno de 93% e no fim em 95%, sem chegar a 100%', () => {
    const ini = resumir(T_INICIO_LACO, iso)
    const fim = resumir(T_FIM_LACO, iso)
    expect(ini.finalizadas / QTD_DEMO).toBeGreaterThan(0.91)
    expect(ini.finalizadas / QTD_DEMO).toBeLessThan(0.95)
    expect(fim.finalizadas / QTD_DEMO).toBeGreaterThanOrEqual(0.95)
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

  it('o canvas tem os 7 postos reais + Entrada, Saída e Manutenção, sem aresta de reprova', () => {
    const { nodes, edges } = fluxoDemo(T_INICIO_LACO, iso)
    const ids = nodes.map((n) => n.id)
    expect(NOMES_POSTOS).toEqual(['Inicial', 'Teste', 'Burn-in', 'Teste Final', 'Inspeção Final', 'Embalagem', 'Inspeção NQA'])
    for (const p of NOMES_POSTOS) expect(ids).toContain(p)
    expect(ids).toEqual(expect.arrayContaining([ENTRADA, SAIDA, MANUTENCAO]))
    expect(edges.some((e) => e.tipo === 'reprova')).toBe(false)
    const saida = nodes.find((n) => n.id === SAIDA)!
    expect(saida.data.wip).toBe(resumir(T_INICIO_LACO, iso).finalizadas)
  })

  it('as peças andam: entre dois instantes do laço há mais finalizadas', () => {
    expect(resumir(T_FIM_LACO, iso).finalizadas).toBeGreaterThan(resumir(T_INICIO_LACO, iso).finalizadas)
  })

  it('peça concluída passou por todos os postos; caixas de 25', () => {
    const pend = pendentesPorPeca(T_INICIO_LACO)
    expect(pend.get(snDaPeca(0))).toBeNull()
    expect(snDaPeca(0)).toBe('EP88000001')
    expect(caixaDaPeca(0)).toBe('CX[1]')
    expect(caixaDaPeca(PECAS_POR_CAIXA)).toBe('CX[2]')
  })

  it('o NQA só inspeciona caixa fechada: nenhum bipe de NQA antes da última peça da caixa ser embalada', () => {
    const bipes = bipesAte(T_FIM_LACO)
    const fecha = new Map<string, number>()
    for (const b of bipes) if (b.posto === 'Embalagem') fecha.set(b.caixa, Math.max(fecha.get(b.caixa) ?? 0, b.minuto))
    const nqa = bipes.filter((b) => b.posto === 'Inspeção NQA')
    expect(nqa.length).toBeGreaterThan(0)
    for (const b of nqa) {
      expect(bipes.filter((x) => x.posto === 'Embalagem' && x.caixa === b.caixa)).toHaveLength(PECAS_POR_CAIXA)
      expect(b.minuto).toBeGreaterThan(fecha.get(b.caixa)!)
    }
  })

  it('burn-in: peças cozinhando têm entrada sem saída', () => {
    // No laço o Burn-in já esvaziou (fim da OP); horas antes ainda tem peça no forno.
    const b = burninDemo(T_INICIO_LACO - 120, 'Burn-in', iso)
    expect(b.emAndamento.length).toBeGreaterThan(0)
    expect(b.entradas.length).toBe(b.saidas.length + b.emAndamento.length)
  })

  it('é determinístico', () => {
    expect(JSON.stringify(resumir(T_INICIO_LACO, iso))).toBe(JSON.stringify(resumir(T_INICIO_LACO, iso)))
  })
})
