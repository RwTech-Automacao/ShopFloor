import { describe, it, expect } from 'vitest'
import { agruparPendencias } from '../manutencao-pendencias'

const rep = (over: Record<string, string>) => ({
  dataHora: '2026-07-23T10:00:00+00:00', cliente: 'C', pmo: 'P', op: '1', sn: '100', snNorm: '100',
  posto: 'Teste', cod: '1002', pos: 'R1', tipo: 'SMD', ...over,
})

describe('agruparPendencias', () => {
  it('agrupa posições da mesma reprova numa ocorrência única', () => {
    const out = agruparPendencias([rep({ pos: 'R1' }), rep({ pos: 'C4' }), rep({ pos: 'R1' })], [])
    expect(out).toHaveLength(1)
    expect(out[0]!.posicoes).toEqual(['R1', 'C4'])
    expect(out[0]!.status).toBe('Pendente')
  })
  it('reprovas em momentos diferentes são ocorrências diferentes', () => {
    const out = agruparPendencias([rep({}), rep({ dataHora: '2026-07-23T11:00:00+00:00' })], [])
    expect(out).toHaveLength(2)
  })
  it('reparo casando (posto de origem + data/hora) conclui a ocorrência', () => {
    const out = agruparPendencias(
      [rep({})],
      [{ pmo: 'P', op: '1', snNorm: '100', postoOrigem: 'Teste', dataHoraOrigem: '2026-07-23T10:00:00+00:00' }],
    )
    expect(out[0]!.status).toBe('Concluída')
  })
  it('reparo de outro posto/momento NÃO conclui', () => {
    const out = agruparPendencias(
      [rep({})],
      [{ pmo: 'P', op: '1', snNorm: '100', postoOrigem: 'Teste Final', dataHoraOrigem: '2026-07-23T10:00:00+00:00' }],
    )
    expect(out[0]!.status).toBe('Pendente')
  })
  it('ordena da mais recente para a mais antiga', () => {
    const out = agruparPendencias([rep({}), rep({ dataHora: '2026-07-23T12:00:00+00:00', sn: '200', snNorm: '200' })], [])
    expect(out[0]!.sn).toBe('200')
  })
})
