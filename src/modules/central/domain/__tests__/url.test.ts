import { describe, it, expect } from 'vitest'
import { centralUrlSegura } from '../url'

describe('centralUrlSegura', () => {
  it('https é sempre aceita, em qualquer host', () => {
    expect(centralUrlSegura('https://central.enterplak.com.br')).toBe(true)
    expect(centralUrlSegura('https://127.0.0.1:3100')).toBe(true)
  })

  it('http só é aceita quando o host é a própria máquina (loopback)', () => {
    expect(centralUrlSegura('http://127.0.0.1:3100')).toBe(true)
    expect(centralUrlSegura('http://localhost:3100')).toBe(true)
    expect(centralUrlSegura('http://[::1]:3100')).toBe(true)
  })

  it('http num host que não é loopback é recusado — o segredo não pode viajar em texto claro pela internet', () => {
    expect(centralUrlSegura('http://central.enterplak.com.br')).toBe(false)
    expect(centralUrlSegura('http://192.168.0.10:3100')).toBe(false)
  })

  it('URL inválida é recusada, não lança', () => {
    expect(centralUrlSegura('não é uma url')).toBe(false)
    expect(centralUrlSegura('')).toBe(false)
  })
})
