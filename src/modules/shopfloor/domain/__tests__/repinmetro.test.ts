import { describe, it, expect } from 'vitest'
import { ITENS_REPINMETRO, PECAS_REP, chaveRevenda, classeResultado, pecasComSerial } from '../repinmetro'

describe('repinmetro', () => {
  it('tem os 15 itens de teste, com chaves únicas', () => {
    expect(ITENS_REPINMETRO).toHaveLength(15)
    const chaves = new Set(ITENS_REPINMETRO.map((i) => i.chave))
    expect(chaves.size).toBe(15)
  })

  it('classifica o resultado por prefixo (case/espaço-insensível)', () => {
    expect(classeResultado('APROVADO')).toBe('aprovado')
    expect(classeResultado(' aprov. ')).toBe('aprovado')
    expect(classeResultado('REPROVADO')).toBe('reprovado')
    expect(classeResultado('NA')).toBe('na')
    expect(classeResultado('')).toBe('na')
    expect(classeResultado(null)).toBe('na')
    expect(classeResultado(undefined)).toBe('na')
  })
})

describe('chaveRevenda', () => {
  it('casa o teste com a revenda pelo modelo + nº de série normalizado', () => {
    expect(chaveRevenda('00562', '0016176')).toBe('00562|16176')
    expect(chaveRevenda(' 00562 ', '16176')).toBe('00562|16176')
  })

  it('não gera chave sem modelo ou sem nº de série', () => {
    expect(chaveRevenda('', '0016176')).toBeNull()
    expect(chaveRevenda(null, '0016176')).toBeNull()
    expect(chaveRevenda('00562', '000')).toBeNull()
  })

  it('o mesmo SN em modelos diferentes gera chaves diferentes', () => {
    expect(chaveRevenda('00401', '0016176')).not.toBe(chaveRevenda('00562', '0016176'))
  })
})

describe('integração do REP', () => {
  it('lista as 6 peças na ordem da tela, com chaves únicas', () => {
    expect(PECAS_REP.map((p) => p.rotulo)).toEqual(['Impressora', 'MRP', 'Módulo biométrico', 'RFID', 'Fonte', 'Leitor de barras'])
    expect(new Set(PECAS_REP.map((p) => p.chave)).size).toBe(6)
  })

  it('acha qual peça tem o serial buscado, ignorando traços e zeros à esquerda', () => {
    const seriais = { serial_impressora: '0123-4567-8901', serial_rfid: '9999-0000-1111', serial_fonte: null }
    expect(pecasComSerial(seriais, '123-4567-8901')).toEqual(['serial_impressora'])
    expect(pecasComSerial(seriais, '012345678901')).toEqual(['serial_impressora'])
    expect(pecasComSerial(seriais, '999900001111')).toEqual(['serial_rfid'])
    expect(pecasComSerial(seriais, '5555')).toEqual([])
    expect(pecasComSerial(seriais, '')).toEqual([])
  })
})
