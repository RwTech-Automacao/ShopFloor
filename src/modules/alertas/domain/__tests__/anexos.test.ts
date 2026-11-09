import { describe, expect, it } from 'vitest'
import { nomeDoQr, qrDoEnvio } from '../anexos'

describe('qrDoEnvio', () => {
  it('devolve o texto do QR quando o envio traz `qr`', () => {
    expect(qrDoEnvio({ qr: 'CX[1][160]8682_F-PMOF52_F' })).toBe('CX[1][160]8682_F-PMOF52_F')
  })

  it('apara espaços e ignora vazio, só espaços, ausente e tipo errado', () => {
    expect(qrDoEnvio({ qr: '  LOTE[03ec5112][6]  ' })).toBe('LOTE[03ec5112][6]')
    expect(qrDoEnvio({ qr: '' })).toBeNull()
    expect(qrDoEnvio({ qr: '   ' })).toBeNull()
    expect(qrDoEnvio({})).toBeNull()
    expect(qrDoEnvio({ qr: 42 })).toBeNull()
    expect(qrDoEnvio({ qr: null })).toBeNull()
  })
})

describe('nomeDoQr', () => {
  it('vira um nome de arquivo seguro, sem os caracteres que quebram nomes', () => {
    expect(nomeDoQr('CX[1][160]8682_F-PMOF52_F')).toBe('qr-CX-1-160-8682_F-PMOF52_F.png')
    expect(nomeDoQr('LOTE[03ec5112][6]')).toBe('qr-LOTE-03ec5112-6.png')
  })

  it('texto sem nada aproveitável cai no nome padrão', () => {
    expect(nomeDoQr('[[]]')).toBe('qr.png')
  })
})
