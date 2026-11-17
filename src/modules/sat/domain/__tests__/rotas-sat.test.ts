import { describe, expect, it } from 'vitest'
import { ehRotaDaSincronizacaoSat } from '../rotas-sat'

describe('ehRotaDaSincronizacaoSat', () => {
  it('só a rota exata (com ou sem barra final) sai da sessão', () => {
    expect(ehRotaDaSincronizacaoSat('/api/sat/sincronizar-planilha')).toBe(true)
    expect(ehRotaDaSincronizacaoSat('/api/sat/sincronizar-planilha/')).toBe(true)
    expect(ehRotaDaSincronizacaoSat('/api/sat/sincronizar-planilha/x')).toBe(false)
    expect(ehRotaDaSincronizacaoSat('/api/sat/sincronizar-planilha-x')).toBe(false)
    expect(ehRotaDaSincronizacaoSat('/api/sat')).toBe(false)
    expect(ehRotaDaSincronizacaoSat('/sat/entrada')).toBe(false)
  })
})
