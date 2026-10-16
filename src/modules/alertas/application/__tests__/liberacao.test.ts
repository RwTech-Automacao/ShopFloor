import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  alertasDisponiveis,
  alertasLiberados,
  alertasLiberadosDoModulo,
  alertasMenuPorModulo,
  alertasRecebimentoLiberados,
} from '../liberacao'

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

describe('alertasDisponiveis em mais de um módulo', () => {
  // O assunto daqui é a RÉGUA DE PERMISSÃO, não o lançamento escondido: sem fixar a liberação,
  // `alertasLiberados` devolveria false (NODE_ENV=test não é 'development' e a lista está vazia) e
  // os casos passariam a medir a variável de ambiente em vez do módulo.
  beforeEach(() => {
    vi.stubEnv('ALERTAS_LIBERADO_PARA', '*')
    vi.stubEnv('ALERTAS_RECEBIMENTO_LIBERADO_PARA', '*')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  const perfilCom = (modulo: 'shopfloor' | 'recebimento') =>
    ({ porModulo: { [modulo]: { administrar: true } } }) as never

  it('libera quem administra só o Recebimento', () => {
    expect(alertasDisponiveis({ email: 'beto@x', perfil: perfilCom('recebimento') })).toBe(true)
  })

  it('libera quem administra só o ShopFloor', () => {
    expect(alertasDisponiveis({ email: 'carla@x', perfil: perfilCom('shopfloor') })).toBe(true)
  })

  it('não libera quem não administra nenhum dos dois (caso 7 da spec)', () => {
    expect(alertasDisponiveis({ email: 'zé@x', perfil: { porModulo: { setup: { administrar: true } } } as never })).toBe(false)
  })
})

describe('trava própria do Recebimento', () => {
  const prod = { node: 'production' }

  afterEach(() => { vi.unstubAllEnvs() })

  it('vazia ou ausente = ninguém em produção', () => {
    expect(alertasRecebimentoLiberados('ana@x.com', undefined, prod)).toBe(false)
    expect(alertasRecebimentoLiberados('ana@x.com', '', prod)).toBe(false)
  })

  it('libera só quem está na lista, e * libera todos', () => {
    expect(alertasRecebimentoLiberados('ana@x.com', 'ANA@x.com, b@x.com', prod)).toBe(true)
    expect(alertasRecebimentoLiberados('fora@x.com', 'ana@x.com', prod)).toBe(false)
    expect(alertasRecebimentoLiberados('qualquer@x.com', '*', prod)).toBe(true)
  })

  it('fora da produção aparece sempre', () => {
    expect(alertasRecebimentoLiberados('ana@x.com', '', { vercel: 'preview', node: 'production' })).toBe(true)
    expect(alertasRecebimentoLiberados('ana@x.com', '', { node: 'development' })).toBe(true)
  })

  it('ShopFloor liberado para todos NÃO abre o Recebimento (o caso do deploy de 16/10)', () => {
    vi.stubEnv('ALERTAS_LIBERADO_PARA', '*')
    vi.stubEnv('ALERTAS_RECEBIMENTO_LIBERADO_PARA', 'gptropa@rwtech.com.br')
    expect(alertasLiberadosDoModulo('shopfloor', 'outra@rwtech.com.br')).toBe(true)
    expect(alertasLiberadosDoModulo('recebimento', 'outra@rwtech.com.br')).toBe(false)
    expect(alertasLiberadosDoModulo('recebimento', 'gptropa@rwtech.com.br')).toBe(true)
    expect(alertasMenuPorModulo('outra@rwtech.com.br')).toEqual({ shopfloor: true, recebimento: false })
    expect(alertasMenuPorModulo('gptropa@rwtech.com.br')).toEqual({ shopfloor: true, recebimento: true })
  })

  it('e a trava do Recebimento não abre o ShopFloor', () => {
    vi.stubEnv('ALERTAS_LIBERADO_PARA', '')
    vi.stubEnv('ALERTAS_RECEBIMENTO_LIBERADO_PARA', '*')
    expect(alertasLiberadosDoModulo('shopfloor', 'ana@x.com')).toBe(false)
    expect(alertasLiberadosDoModulo('recebimento', 'ana@x.com')).toBe(true)
  })

  it('quem administra só o Recebimento não vê Meu perfil enquanto o Recebimento está fechado', () => {
    vi.stubEnv('ALERTAS_LIBERADO_PARA', '*')
    vi.stubEnv('ALERTAS_RECEBIMENTO_LIBERADO_PARA', 'gptropa@rwtech.com.br')
    const soRec = { porModulo: { recebimento: { administrar: true } } } as never
    const soSf = { porModulo: { shopfloor: { administrar: true } } } as never
    expect(alertasDisponiveis({ email: 'beto@x', perfil: soRec })).toBe(false)
    expect(alertasDisponiveis({ email: 'gptropa@rwtech.com.br', perfil: soRec })).toBe(true)
    expect(alertasDisponiveis({ email: 'beto@x', perfil: soSf })).toBe(true)
  })
})
