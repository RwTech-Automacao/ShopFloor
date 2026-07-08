import { describe, it, expect } from 'vitest'
import { validarTipoCampo } from '../regras-campo'

describe('validarTipoCampo', () => {
  it('bloqueia tipo lista sem lista_chave', () => {
    const r = validarTipoCampo({ tipoAtual: 'texto', tipoSubmetido: 'lista', listaChave: null })
    expect(r.ok).toBe(false)
  })

  it('permite tipo lista com lista_chave preenchida', () => {
    const r = validarTipoCampo({
      tipoAtual: 'texto',
      tipoSubmetido: 'lista',
      listaChave: 'fornecedor',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tipo).toBe('lista')
  })

  it('permite manter texto sem lista_chave', () => {
    const r = validarTipoCampo({ tipoAtual: 'texto', tipoSubmetido: 'texto', listaChave: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tipo).toBe('texto')
  })

  it('mantém tipo numero fixo mesmo se texto/lista for submetido', () => {
    const r = validarTipoCampo({ tipoAtual: 'numero', tipoSubmetido: 'texto', listaChave: null })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tipo).toBe('numero')
  })

  it('mantém tipo data fixo mesmo se lista for submetido com lista_chave', () => {
    const r = validarTipoCampo({
      tipoAtual: 'data',
      tipoSubmetido: 'lista',
      listaChave: 'fornecedor',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.tipo).toBe('data')
  })
})
