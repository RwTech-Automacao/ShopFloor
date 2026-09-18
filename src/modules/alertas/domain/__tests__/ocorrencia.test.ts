import { describe, it, expect } from 'vitest'
import { dataIsoSaoPaulo, filtroOcorrenciasPadrao, periodoOcorrencias } from '../ocorrencia'

describe('dataIsoSaoPaulo', () => {
  it('usa o dia do fuso de São Paulo, não o do UTC', () => {
    // 02:00Z de 18/09 ainda é 23:00 de 17/09 em São Paulo
    expect(dataIsoSaoPaulo(new Date('2026-09-18T02:00:00Z'))).toBe('2026-09-17')
  })
})

describe('periodoOcorrencias', () => {
  it('abre o dia inicial e fecha o dia final no fuso de São Paulo', () => {
    expect(periodoOcorrencias('2026-09-11', '2026-09-17')).toEqual({
      de: '2026-09-11T00:00:00-03:00',
      ate: '2026-09-17T23:59:59.999-03:00',
    })
  })
  it('recusa data fora de formato ou período invertido', () => {
    expect(periodoOcorrencias('11/09/2026', '2026-09-17')).toBeNull()
    expect(periodoOcorrencias('2026-09-17', '2026-09-11')).toBeNull()
  })
})

describe('filtroOcorrenciasPadrao', () => {
  it('últimos 7 dias, todos os estados', () => {
    expect(filtroOcorrenciasPadrao(new Date('2026-09-17T12:00:00Z'))).toEqual({
      de: '2026-09-11',
      ate: '2026-09-17',
      estado: '',
    })
  })
})
