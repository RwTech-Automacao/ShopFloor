import { describe, expect, it } from 'vitest'
import { novaOpLiberada } from '../liberacao-nova-op'

describe('novaOpLiberada', () => {
  it('ninguém quando a variável está vazia, ausente ou só espaços', () => {
    expect(novaOpLiberada('ana@x.com', '')).toBe(false)
    expect(novaOpLiberada('ana@x.com', undefined)).toBe(false)
    expect(novaOpLiberada('ana@x.com', '   ')).toBe(false)
    expect(novaOpLiberada(null, '')).toBe(false)
  })

  it('* libera todo mundo, mesmo misturado com e-mails', () => {
    expect(novaOpLiberada('ana@x.com', '*')).toBe(true)
    expect(novaOpLiberada(null, '*')).toBe(true)
    expect(novaOpLiberada('ana@x.com', 'beto@x.com, *')).toBe(true)
  })

  it('libera só quem está na lista, sem olhar maiúsculas e com trim', () => {
    const lista = ' Ana@X.com , beto@x.com '
    expect(novaOpLiberada('ana@x.com', lista)).toBe(true)
    expect(novaOpLiberada('  BETO@X.COM ', lista)).toBe(true)
    expect(novaOpLiberada('carla@x.com', lista)).toBe(false)
  })

  it('e-mail nulo/vazio não é liberado quando a lista não está vazia', () => {
    expect(novaOpLiberada(null, 'ana@x.com')).toBe(false)
    expect(novaOpLiberada(undefined, 'ana@x.com')).toBe(false)
    expect(novaOpLiberada('', 'ana@x.com')).toBe(false)
  })

  describe('fora da produção a tela aparece sempre', () => {
    it('preview da Vercel e dev local liberam sem a variável', () => {
      expect(novaOpLiberada('ana@x.com', undefined, { vercel: 'preview', node: 'production' })).toBe(true)
      expect(novaOpLiberada('ana@x.com', '', { vercel: 'development' })).toBe(true)
      expect(novaOpLiberada('ana@x.com', '', { node: 'development' })).toBe(true)
    })

    it('produção (AWS ou Vercel) segue a lista', () => {
      expect(novaOpLiberada('ana@x.com', undefined, { node: 'production' })).toBe(false)
      expect(novaOpLiberada('ana@x.com', 'ana@x.com', { node: 'production' })).toBe(true)
      expect(novaOpLiberada('ana@x.com', '', { vercel: 'production', node: 'production' })).toBe(false)
    })
  })
})
