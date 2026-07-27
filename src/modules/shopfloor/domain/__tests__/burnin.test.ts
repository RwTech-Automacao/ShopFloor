import { describe, it, expect } from 'vitest'
import { pareaBurnin, estaAberto, formatarDuracao } from '../burnin'

const r = (dataHora: string, status: string) => ({ dataHora, status })

describe('pareaBurnin', () => {
  it('pareia entrada→saída num ciclo com duração em minutos', () => {
    const c = pareaBurnin([r('2026-07-24T08:00:00Z', ''), r('2026-07-24T14:30:00Z', 'Aprovado')])
    expect(c).toHaveLength(1)
    expect(c[0]!.saida).toBe('2026-07-24T14:30:00Z')
    expect(c[0]!.status).toBe('Aprovado')
    expect(c[0]!.duracaoMin).toBe(390)
    expect(estaAberto(c)).toBe(false)
  })
  it('entrada sem saída → ciclo aberto', () => {
    const c = pareaBurnin([r('2026-07-24T09:00:00Z', '')])
    expect(c).toHaveLength(1)
    expect(c[0]!.saida).toBeNull()
    expect(c[0]!.duracaoMin).toBeNull()
    expect(estaAberto(c)).toBe(true)
  })
  it('reprova→re-entrada = 2 ciclos (1 fechado, 1 aberto); saída órfã ignorada', () => {
    const c = pareaBurnin([
      r('2026-07-24T08:00:00Z', ''),
      r('2026-07-24T10:00:00Z', 'Reprovado'),
      r('2026-07-24T10:00:00Z', 'Reprovado'), // 2º defeito, mesmo instante → não abre ciclo
      r('2026-07-24T12:00:00Z', ''),
    ])
    expect(c).toHaveLength(2)
    expect(c[0]!.status).toBe('Reprovado')
    expect(c[1]!.saida).toBeNull()
    expect(estaAberto(c)).toBe(true)
  })
})

describe('formatarDuracao', () => {
  it('minutos → HhMM', () => {
    expect(formatarDuracao(390)).toBe('6h30')
    expect(formatarDuracao(42)).toBe('0h42')
  })
})
