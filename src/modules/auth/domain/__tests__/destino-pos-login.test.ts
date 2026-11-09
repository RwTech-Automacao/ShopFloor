import { describe, it, expect } from 'vitest'
import { destinoPosLogin, DESTINO_PADRAO } from '../destino-pos-login'

describe('destinoPosLogin', () => {
  it('aceita caminho interno, com query e âncora', () => {
    expect(destinoPosLogin('/recebimento/emb/EMB388CA')).toBe('/recebimento/emb/EMB388CA')
    expect(destinoPosLogin('/shopfloor/analisar/parados?regra=abc&x=1')).toBe(
      '/shopfloor/analisar/parados?regra=abc&x=1',
    )
    expect(destinoPosLogin('/shopfloor/fluxo#topo')).toBe('/shopfloor/fluxo#topo')
    expect(destinoPosLogin('/')).toBe('/')
  })

  it('URL de outro domínio vira /home', () => {
    for (const v of ['//evil.com', '//evil.com/home', '/\\evil.com', '/\\/evil.com', 'https://evil.com', 'http://evil.com/home', 'HTTPS://evil.com']) {
      expect(destinoPosLogin(v), v).toBe(DESTINO_PADRAO)
    }
  })

  it('esquema perigoso ou caminho sem barra inicial vira /home', () => {
    for (const v of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,oi', 'home', 'evil.com', ' /home', '\t//evil.com']) {
      expect(destinoPosLogin(v), v).toBe(DESTINO_PADRAO)
    }
  })

  it('quebra de linha, tab ou caractere de controle vira /home (o navegador os remove e "/\\t/x" vira "//x")', () => {
    for (const v of ['/\t/evil.com', '/\n/evil.com', '/home\r\nSet-Cookie: x=1', '/home\u0000', '/home\u007f']) {
      expect(destinoPosLogin(v), JSON.stringify(v)).toBe(DESTINO_PADRAO)
    }
  })

  it('vazio, ausente ou não-texto vira /home', () => {
    for (const v of ['', null, undefined, 42, ['/home'], {}]) {
      expect(destinoPosLogin(v), String(v)).toBe(DESTINO_PADRAO)
    }
  })

  it('/login vira /home, para não entrar em laço', () => {
    for (const v of ['/login', '/login?next=/x', '/login/', '/login#a']) {
      expect(destinoPosLogin(v), v).toBe(DESTINO_PADRAO)
    }
    // só o /login exato: rota que apenas começa igual passa
    expect(destinoPosLogin('/loginx')).toBe('/loginx')
  })

  it('destino gigante vira /home', () => {
    expect(destinoPosLogin('/' + 'a'.repeat(5000))).toBe(DESTINO_PADRAO)
  })
})
