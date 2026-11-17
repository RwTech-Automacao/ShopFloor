import { describe, expect, it } from 'vitest'
import { ehRotaDoManifestoDaBaixaNf, manifestoDaBaixaNf, ROTA_MANIFESTO_BAIXA_NF } from '../app-baixa-nf'

describe('ehRotaDoManifestoDaBaixaNf', () => {
  it('só o caminho exato do manifesto sai da sessão (o navegador busca sem cookie)', () => {
    expect(ROTA_MANIFESTO_BAIXA_NF).toBe('/faturamento/manifest.webmanifest')
    expect(ehRotaDoManifestoDaBaixaNf('/faturamento/manifest.webmanifest')).toBe(true)
    expect(ehRotaDoManifestoDaBaixaNf('/faturamento/manifest.webmanifest/')).toBe(false)
    expect(ehRotaDoManifestoDaBaixaNf('/faturamento/baixa-nf')).toBe(false)
    expect(ehRotaDoManifestoDaBaixaNf('/faturamento/manifest.webmanifestx')).toBe(false)
    expect(ehRotaDoManifestoDaBaixaNf('/faturamento')).toBe(false)
  })
})

describe('manifestoDaBaixaNf', () => {
  it('instalável: nomes, escopo do Faturamento, standalone, ícones 192 e 512', () => {
    const m = manifestoDaBaixaNf()
    expect(m).toMatchObject({
      name: 'Baixa de NF — ShopFloor', short_name: 'Baixa de NF', id: '/faturamento/baixa-nf',
      start_url: '/faturamento/baixa-nf', scope: '/faturamento/', display: 'standalone',
      theme_color: '#8d2033', background_color: '#f5f6f8',
    })
    expect(m.start_url!.startsWith(m.scope!)).toBe(true)
    expect(m.icons!.map((i) => i.sizes)).toEqual(['192x192', '512x512'])
    // ícones em .png: o matcher do middleware já deixa .png passar sem sessão
    expect(m.icons!.every((i) => i.src.endsWith('.png') && i.type === 'image/png')).toBe(true)
  })
})
