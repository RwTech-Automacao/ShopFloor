import { describe, it, expect } from 'vitest'
import { compararPorPosicao, maisRecentePrimeiro } from '../ordenacao-itens'

const item = (posicao: string, feeder: string, criadoEm: string, extra: Record<string, unknown> = {}) =>
  ({ posicao, feeder, criadoEm, ...extra })

describe('compararPorPosicao (a ordem canônica, usada por Abastecimento e Consultas)', () => {
  it('compara posição como número: "2" antes de "10"', () => {
    const lista = [item('10', 'F10', ''), item('2', 'F2', ''), item('1', 'F1', '')]
    expect(lista.sort(compararPorPosicao).map((i) => i.posicao)).toEqual(['1', '2', '10'])
  })
  it('desempata pelo feeder, também numérico', () => {
    const lista = [item('5', 'F10', ''), item('5', 'F2', '')]
    expect(lista.sort(compararPorPosicao).map((i) => i.feeder)).toEqual(['F2', 'F10'])
  })
})

describe('maisRecentePrimeiro', () => {
  it('ordena do criado mais recentemente para o mais antigo', () => {
    const a = item('1', 'F1', '2026-10-09T10:00:00Z')
    const b = item('2', 'F2', '2026-10-09T10:01:00Z')
    const c = item('3', 'F3', '2026-10-09T10:02:00Z')
    expect(maisRecentePrimeiro([a, b, c])).toEqual([c, b, a])
  })

  it('EDITAR NÃO MOVE A LINHA: atualizadoEm é ignorado, só criadoEm conta', () => {
    // O item mais antigo foi editado agora há pouco (atualizadoEm é o mais recente de todos).
    // Quem ordenasse por atualizadoEm subiria "antigo" para o topo; o desenho correto não.
    const antigo = item('1', 'F1', '2026-10-09T10:00:00Z', { atualizadoEm: '2026-10-09T18:00:00Z' })
    const meio = item('2', 'F2', '2026-10-09T10:01:00Z', { atualizadoEm: '2026-10-09T10:01:00Z' })
    const novo = item('3', 'F3', '2026-10-09T10:02:00Z', { atualizadoEm: '2026-10-09T10:02:00Z' })
    expect(maisRecentePrimeiro([antigo, meio, novo]).map((i) => i.posicao)).toEqual(['3', '2', '1'])
  })

  it('empate de criadoEm desempata por posição (numérica), sempre igual entre duas leituras', () => {
    const mesmo = '2026-10-09T10:00:00Z'
    const embaralhado = [item('10', 'F10', mesmo), item('2', 'F2', mesmo), item('1', 'F1', mesmo)]
    const esperado = ['1', '2', '10']
    expect(maisRecentePrimeiro(embaralhado).map((i) => i.posicao)).toEqual(esperado)
    expect(maisRecentePrimeiro([...embaralhado].reverse()).map((i) => i.posicao)).toEqual(esperado)
  })

  it('item de antes da migração (criadoEm vindo do backfill) convive com os novos, sem buraco', () => {
    const antigoBackfill = item('1', 'F1', '2026-09-01T08:00:00Z')
    const novo = item('2', 'F2', '2026-10-09T10:00:00Z')
    expect(maisRecentePrimeiro([antigoBackfill, novo]).map((i) => i.posicao)).toEqual(['2', '1'])
  })

  it('não altera o array de entrada e preserva os outros campos do objeto', () => {
    const entrada = [item('1', 'F1', '2026-10-09T10:00:00Z', { id: 'a' }), item('2', 'F2', '2026-10-09T10:01:00Z', { id: 'b' })]
    const copia = [...entrada]
    const saida = maisRecentePrimeiro(entrada)
    expect(entrada).toEqual(copia)
    expect(saida).not.toBe(entrada)
    expect(saida[0]).toMatchObject({ id: 'b' })
  })

  it('lista vazia devolve lista vazia', () => {
    expect(maisRecentePrimeiro([])).toEqual([])
  })
})
