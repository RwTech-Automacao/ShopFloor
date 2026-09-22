import { describe, it, expect } from 'vitest'
import { alertasDisponiveis, alertasLiberados } from '../liberacao'

describe('alertasLiberados', () => {
  it('ninguém é liberado quando a variável está vazia', () => {
    expect(alertasLiberados('qualquer@rwtech.com.br', '')).toBe(false)
    expect(alertasLiberados(null, '')).toBe(false)
    expect(alertasLiberados(undefined, '')).toBe(false)
  })

  it('ninguém é liberado quando a variável está ausente (undefined)', () => {
    expect(alertasLiberados('qualquer@rwtech.com.br', undefined)).toBe(false)
  })

  it('ninguém é liberado quando a variável é só espaços', () => {
    expect(alertasLiberados('qualquer@rwtech.com.br', '   ')).toBe(false)
  })

  it('* libera todo mundo', () => {
    expect(alertasLiberados('qualquer@rwtech.com.br', '*')).toBe(true)
  })

  it('libera só quem está na lista', () => {
    const lista = 'gptropa@rwtech.com.br, outra@rwtech.com.br'
    expect(alertasLiberados('gptropa@rwtech.com.br', lista)).toBe(true)
    expect(alertasLiberados('outra@rwtech.com.br', lista)).toBe(true)
    expect(alertasLiberados('fora@rwtech.com.br', lista)).toBe(false)
  })

  it('compara sem diferenciar maiúsculas/minúsculas e com trim', () => {
    const lista = ' Gptropa@RwTech.com.br ,  outra@rwtech.com.br  '
    expect(alertasLiberados('gptropa@rwtech.com.br', lista)).toBe(true)
    expect(alertasLiberados('  GPTROPA@RWTECH.COM.BR  ', lista)).toBe(true)
  })

  it('* libera todo mundo', () => {
    expect(alertasLiberados('quemquerque@rwtech.com.br', '*')).toBe(true)
    expect(alertasLiberados(null, '*')).toBe(true)
  })

  it('* funciona mesmo misturado com outros e-mails na lista', () => {
    expect(alertasLiberados('quemquerque@rwtech.com.br', 'fulano@rwtech.com.br, *')).toBe(true)
  })

  it('e-mail nulo/ausente não é liberado quando a lista não está vazia', () => {
    const lista = 'gptropa@rwtech.com.br'
    expect(alertasLiberados(null, lista)).toBe(false)
    expect(alertasLiberados(undefined, lista)).toBe(false)
    expect(alertasLiberados('', lista)).toBe(false)
  })

  describe('fora da produção a feature aparece sempre', () => {
    it('preview da Vercel libera mesmo sem a variável', () => {
      expect(alertasLiberados('ana@x.com', undefined, { vercel: 'preview', node: 'production' })).toBe(true)
    })

    it('dev local (npm run dev) libera mesmo sem a variável', () => {
      expect(alertasLiberados('ana@x.com', '', { node: 'development' })).toBe(true)
    })

    it('produção na AWS (sem VERCEL_ENV) segue a lista', () => {
      expect(alertasLiberados('ana@x.com', undefined, { node: 'production' })).toBe(false)
      expect(alertasLiberados('ana@x.com', 'ana@x.com', { node: 'production' })).toBe(true)
    })

    it('produção da Vercel também segue a lista', () => {
      expect(alertasLiberados('ana@x.com', '', { vercel: 'production', node: 'production' })).toBe(false)
    })
  })
})

describe('alertasDisponiveis (menu, Meu perfil e vínculo)', () => {
  const admin = { porModulo: { shopfloor: { administrar: true } } } as never
  const operador = { porModulo: { shopfloor: { visualizar: true, lancar: true } } } as never

  it('exige administrar no ShopFloor', () => {
    expect(alertasDisponiveis({ email: 'ana@x.com', perfil: operador })).toBe(false)
  })

  it('admin do ShopFloor segue a liberação (no teste, NODE_ENV=test → lista)', () => {
    process.env.ALERTAS_LIBERADO_PARA = '*'
    expect(alertasDisponiveis({ email: 'ana@x.com', perfil: admin })).toBe(true)
    delete process.env.ALERTAS_LIBERADO_PARA
    expect(alertasDisponiveis({ email: 'ana@x.com', perfil: admin })).toBe(false)
  })

  it('sem sessão, nada', () => {
    expect(alertasDisponiveis(null)).toBe(false)
  })
})
