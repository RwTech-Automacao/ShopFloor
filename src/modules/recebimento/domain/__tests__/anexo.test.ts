import { describe, expect, it } from 'vitest'
import { extensaoDoMime, validarArquivoImagem, TAMANHO_MAX_ANEXO } from '../anexo'

describe('extensaoDoMime', () => {
  it('mapeia mimes de imagem suportados', () => {
    expect(extensaoDoMime('image/jpeg')).toBe('jpg')
    expect(extensaoDoMime('image/png')).toBe('png')
    expect(extensaoDoMime('image/webp')).toBe('webp')
  })
  it('retorna null para mime não suportado', () => {
    expect(extensaoDoMime('image/gif')).toBeNull()
    expect(extensaoDoMime('application/pdf')).toBeNull()
    expect(extensaoDoMime('')).toBeNull()
  })
})

describe('validarArquivoImagem', () => {
  it('aceita imagem suportada com tamanho válido', () => {
    expect(validarArquivoImagem('image/jpeg', 500_000)).toEqual({ ok: true })
  })
  it('rejeita formato não suportado', () => {
    expect(validarArquivoImagem('image/gif', 500_000)).toEqual({
      ok: false,
      erro: 'Formato não suportado (use JPEG, PNG ou WebP).',
    })
  })
  it('rejeita arquivo vazio', () => {
    expect(validarArquivoImagem('image/png', 0)).toEqual({ ok: false, erro: 'Arquivo vazio.' })
  })
  it('rejeita acima do limite', () => {
    expect(validarArquivoImagem('image/png', TAMANHO_MAX_ANEXO + 1)).toEqual({
      ok: false,
      erro: 'Arquivo muito grande (máx. 5 MB).',
    })
  })
})
