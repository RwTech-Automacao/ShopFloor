import { describe, expect, it } from 'vitest'
import {
  SHOPFLOOR_URL_PADRAO, baseDoShopfloor, linhaVerRelatorio, urlRelatorioEmb, urlRelatorioParados,
} from '../links'

describe('baseDoShopfloor', () => {
  it('sem a variável (ou vazia) usa o endereço de produção', () => {
    expect(baseDoShopfloor(undefined)).toBe('https://shopfloor.enterplak.com.br')
    expect(baseDoShopfloor(null)).toBe(SHOPFLOOR_URL_PADRAO)
    expect(baseDoShopfloor('   ')).toBe(SHOPFLOOR_URL_PADRAO)
  })
  it('tira espaços e barras do fim', () => {
    expect(baseDoShopfloor(' https://dev.exemplo.com/ ')).toBe('https://dev.exemplo.com')
    expect(baseDoShopfloor('http://localhost:3000//')).toBe('http://localhost:3000')
  })
  it('mantém um caminho base (app atrás de um prefixo)', () => {
    expect(baseDoShopfloor('https://exemplo.com/app/')).toBe('https://exemplo.com/app')
  })
  it('o que não é http(s) vira o padrão (link quebrado é pior)', () => {
    expect(baseDoShopfloor('shopfloor.enterplak.com.br')).toBe(SHOPFLOOR_URL_PADRAO)
    expect(baseDoShopfloor('ftp://x.com')).toBe(SHOPFLOOR_URL_PADRAO)
    expect(baseDoShopfloor('https://')).toBe(SHOPFLOOR_URL_PADRAO)
  })
})

describe('urls dos relatórios', () => {
  it('parados: a regra vai na query', () => {
    expect(urlRelatorioParados('https://s.com', '3f2a-uuid')).toBe('https://s.com/shopfloor/analisar/parados?regra=3f2a-uuid')
  })
  it('parados: id com caractere estranho é codificado', () => {
    expect(urlRelatorioParados('https://s.com', 'a b&c')).toBe('https://s.com/shopfloor/analisar/parados?regra=a%20b%26c')
  })
  it('EMB: no caminho, codificada e sem espaços nas pontas', () => {
    expect(urlRelatorioEmb('https://s.com', 'EMB388CA')).toBe('https://s.com/recebimento/emb/EMB388CA')
    expect(urlRelatorioEmb('https://s.com', ' EMB 1/2 ')).toBe('https://s.com/recebimento/emb/EMB%201%2F2')
  })
  it('a linha da mensagem', () => {
    expect(linhaVerRelatorio('https://s.com/x')).toBe('Ver relatório completo: https://s.com/x')
  })
})
