import { describe, it, expect } from 'vitest'
import { ehRotaPublicaDaCentral } from '../rotas'

describe('ehRotaPublicaDaCentral', () => {
  it('a rota do cron da sincronização é pública', () => {
    expect(ehRotaPublicaDaCentral('/api/central/sincronizar')).toBe(true)
  })

  it('casamento exato: barra final NÃO conta como a mesma rota', () => {
    expect(ehRotaPublicaDaCentral('/api/central/sincronizar/')).toBe(false)
  })

  it('prefixo parecido não engana (ex.: /api/centralx)', () => {
    expect(ehRotaPublicaDaCentral('/api/centralx')).toBe(false)
  })

  it('outra rota dentro de /api/central não é pública', () => {
    expect(ehRotaPublicaDaCentral('/api/central/outra')).toBe(false)
  })

  it('raiz e caminhos não relacionados não são públicos', () => {
    expect(ehRotaPublicaDaCentral('/')).toBe(false)
    expect(ehRotaPublicaDaCentral('/api/alertas')).toBe(false)
  })
})
