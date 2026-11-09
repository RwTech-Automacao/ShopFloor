// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { gerarQrDataUrl, gerarQrPng } from '../qr'

describe('gerarQrPng', () => {
  it('gera um PNG de verdade (assinatura 89 50 4E 47) com conteúdo', async () => {
    const bytes = await gerarQrPng('CX[1][160]8682_F-PMOF52_F')
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(bytes.length).toBeGreaterThan(200)
  })

  it('textos diferentes dão imagens diferentes', async () => {
    const a = await gerarQrPng('CX[1][160]8682_F-PMOF52_F')
    const b = await gerarQrPng('CX[2][160]8682_F-PMOF52_F')
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })
})

describe('gerarQrDataUrl', () => {
  it('devolve um data: URI de PNG que decodifica num PNG de verdade', async () => {
    const url = await gerarQrDataUrl('LOTE[03ec5112][6]')
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const bytes = Buffer.from(url.slice('data:image/png;base64,'.length), 'base64')
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })
})
