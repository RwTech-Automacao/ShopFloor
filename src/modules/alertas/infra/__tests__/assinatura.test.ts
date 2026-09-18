// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign } from 'node:crypto'
import { verificarAssinaturaDiscord, segredoConfere } from '../assinatura'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const der = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
const CHAVE_HEX = der.subarray(12).toString('hex') // é isso que o Discord mostra no portal
const assinar = (timestamp: string, corpo: string) =>
  sign(null, Buffer.from(timestamp + corpo), privateKey).toString('hex')

describe('verificarAssinaturaDiscord', () => {
  it('a chave do portal são os 32 bytes crus depois do prefixo SPKI de Ed25519', () => {
    expect(der.subarray(0, 12).toString('hex')).toBe('302a300506032b6570032100')
    expect(CHAVE_HEX).toHaveLength(64)
  })

  it('aceita a assinatura de timestamp + corpo', () => {
    const corpo = JSON.stringify({ type: 1 })
    const ts = '1789000000'
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinar(ts, corpo), ts, corpo)).toBe(true)
  })

  it('recusa quando o corpo muda', () => {
    const ts = '1789000000'
    const assinatura = assinar(ts, JSON.stringify({ type: 1 }))
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinatura, ts, JSON.stringify({ type: 3 }))).toBe(false)
  })

  it('recusa quando o timestamp muda', () => {
    const corpo = JSON.stringify({ type: 1 })
    const assinatura = assinar('1789000000', corpo)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinatura, '1789000001', corpo)).toBe(false)
  })

  it('recusa assinatura de outra chave', () => {
    const outro = generateKeyPairSync('ed25519')
    const corpo = JSON.stringify({ type: 1 })
    const ts = '1789000000'
    const assinatura = sign(null, Buffer.from(ts + corpo), outro.privateKey).toString('hex')
    expect(verificarAssinaturaDiscord(CHAVE_HEX, assinatura, ts, corpo)).toBe(false)
  })

  it('recusa entradas ausentes ou com formato errado', () => {
    const corpo = '{}'
    expect(verificarAssinaturaDiscord(CHAVE_HEX, null, '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, 'aa', '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord('', 'aa'.repeat(64), '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, 'zz'.repeat(64), '1', corpo)).toBe(false)
    expect(verificarAssinaturaDiscord(CHAVE_HEX, 'aa'.repeat(64), null, corpo)).toBe(false)
  })
})

describe('segredoConfere', () => {
  it('aceita o segredo igual', () => {
    expect(segredoConfere('abc123', 'abc123')).toBe(true)
  })
  it('recusa diferente, vazio ou ausente', () => {
    expect(segredoConfere('abc124', 'abc123')).toBe(false)
    expect(segredoConfere('abc', 'abc123')).toBe(false)
    expect(segredoConfere(null, 'abc123')).toBe(false)
    expect(segredoConfere('abc123', '')).toBe(false)
  })
})
