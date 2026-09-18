import { describe, it, expect } from 'vitest'
import { normalizarFace, facesSobrepoem, FACES } from '../face'

describe('face', () => {
  it('normaliza as três faces e a forma invertida', () => {
    expect(normalizarFace('top')).toBe('TOP')
    expect(normalizarFace(' BOT ')).toBe('BOT')
    expect(normalizarFace('TOP E BOT')).toBe('TOP E BOT')
    expect(normalizarFace('bot  e  top')).toBe('TOP E BOT')
    expect(normalizarFace('LADO A')).toBeNull()
  })
  it('TOP E BOT sobrepõe as duas faces', () => {
    expect(facesSobrepoem('TOP', 'TOP')).toBe(true)
    expect(facesSobrepoem('TOP', 'BOT')).toBe(false)
    expect(facesSobrepoem('TOP E BOT', 'BOT')).toBe(true)
    expect(facesSobrepoem('TOP', 'TOP E BOT')).toBe(true)
  })
  it('lista as faces na ordem da tela', () => {
    expect(FACES).toEqual(['TOP', 'BOT', 'TOP E BOT'])
  })
})
