import { describe, it, expect } from 'vitest'
import { lerComposicao } from '../composicao-erp'

const CAB = ['NÍVEL', 'CÓDIGO ITEM', 'DESCRIÇÃO ITEM', 'DESCRIÇÃO ITEM (Inglês)', 'NCM', 'ORIGEM', 'QUANTIDADE', 'UNIDADE', 'LOCALIZAÇÃO']
const linha = (nivel: number, codigo: string, desc: string, loc = '') => [nivel, codigo, desc, '', '', '', 1, 'UN', loc]

// Recorte fiel da composição da PMOG13.
const PLANILHA: unknown[][] = [
  ['EMPRESA', 'ENTERPLAK PRODUTOS ELETRONICOS LTDA'],
  [],
  CAB,
  linha(1, 'PMOG13', 'PLACA VVC117 PRINCIPAL'),
  linha(2, 'EMB110', 'CAIXA PADRAO'),
  linha(2, 'PRT787', 'PARTES PTH DA PLACA VVC117'),
  linha(3, 'BAR180', '.BARRA DE PINOS', 'CN6'),
  linha(3, 'CON802', '.CONECTOR', 'CN1'),
  linha(3, 'PRT788', 'PARTES SMD DA PLACA VVC117'),
  linha(4, 'CAPJ41', '.CAPACITOR', 'C1, C12'),
  linha(4, 'resr85', '.RESISTOR', 'R11'),
  linha(4, 'PCI624', 'PLACA DE CIRCUITO IMPRESSO'),
  linha(4, 'CAPJ41', '.CAPACITOR REPETIDO', 'C2'),
  linha(2, 'SAC005', 'SACO ESD'),
]

describe('lerComposicao', () => {
  it('pega a PMO do nível 1', () => {
    expect(lerComposicao(PLANILHA).pmo).toBe('PMOG13')
  })
  it('importa só linhas com localização, com o processo do subconjunto pai', () => {
    const r = lerComposicao(PLANILHA)
    expect(r.componentes).toEqual([
      { componente: 'BAR180', processo: 'PTH', linha: 7 },
      { componente: 'CON802', processo: 'PTH', linha: 8 },
      { componente: 'CAPJ41', processo: 'SMD', linha: 10 },
      { componente: 'RESR85', processo: 'SMD', linha: 11 },
    ])
  })
  it('lista ignorados com motivo e duplicados', () => {
    const r = lerComposicao(PLANILHA)
    expect(r.ignorados.map((i) => i.codigo)).toEqual(['EMB110', 'PRT787', 'PRT788', 'PCI624', 'SAC005'])
    expect(r.ignorados[0]!.motivo).toBe('Sem localização (não é componente de montagem).')
    expect(r.duplicados).toEqual(['CAPJ41'])
    expect(r.erro).toBeNull()
  })
  it('componente com localização fora de PARTES SMD/PTH fica ignorado', () => {
    const r = lerComposicao([CAB, linha(1, 'PMOX', 'PLACA'), linha(2, 'CAPJ41', '.CAP', 'C1')])
    expect(r.componentes).toEqual([])
    expect(r.ignorados).toEqual([{ linha: 3, codigo: 'CAPJ41', motivo: 'Processo indefinido (fora de PARTES SMD/PTH).' }])
  })
  it('componente com separador fica ignorado (nunca casa com o prefixo do rolo)', () => {
    const r = lerComposicao([CAB, linha(1, 'PMOX', 'PLACA'), linha(2, 'PRT788', 'PARTES SMD'), linha(3, 'CAP-J41', '.CAP', 'C1')])
    expect(r.componentes).toEqual([])
    expect(r.ignorados).toContainEqual({ linha: 4, codigo: 'CAP-J41', motivo: 'código com separador' })
  })
  it('erro quando não acha o cabeçalho ou o nível 1', () => {
    expect(lerComposicao([['A', 'B']]).erro).toBe('Cabeçalho não encontrado (colunas NÍVEL e CÓDIGO ITEM).')
    expect(lerComposicao([CAB, linha(2, 'X', 'Y', 'C1')]).erro).toBe('Não encontrei a PMO (linha de nível 1).')
  })
})
