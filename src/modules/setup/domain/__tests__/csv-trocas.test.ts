import { describe, it, expect } from 'vitest'
import { trocasParaCsv } from '../csv-trocas'
import type { Troca } from '../../infra/setup-repository'

const BASE: Troca = {
  id: '1', setupId: 's', pmo: 'PMOG13', op: '9001', processo: 'SMD', equipamentoId: 'e1',
  linha: '1', bloco: 'A', maquina: 'YSM10', face: 'TOP',
  posicao: '36', feeder: 'ZSY-1', roloSaida: 'CAPJ41-A', roloEntrada: 'CAPJ41-B', snInicial: '2690010010',
  resultado: 'REPROVADO', motivos: ['Motivo 1.', 'Motivo; 2.'], operadorNome: 'Ana', colaborador: 'BIA 123',
  dataHora: '2026-09-17T12:00:00Z',
}

describe('trocasParaCsv', () => {
  it('gera ; com BOM, cabeçalho e motivos juntos', () => {
    const csv = trocasParaCsv([BASE])
    expect(csv.startsWith('﻿Data/hora;PMO;OP;Processo;Linha;Bloco;Máquina;Face;Posição;Feeder;Rolo que saiu;Rolo que entrou;SN Inicial;Resultado;Motivos;Operador;Colaborador\n')).toBe(true)
    expect(csv).toContain(';REPROVADO;"Motivo 1. Motivo; 2.";Ana;BIA 123')
  })

  it('escapa aspas duplas dentro do valor', () => {
    const csv = trocasParaCsv([{ ...BASE, operadorNome: 'Ana "Turno 2"' }])
    expect(csv).toContain('"Ana ""Turno 2"""')
  })

  it('coloca entre aspas valor com quebra de linha', () => {
    const csv = trocasParaCsv([{ ...BASE, motivos: ['Linha 1\nLinha 2'] }])
    expect(csv).toContain('"Linha 1\nLinha 2"')
  })

  it('coloca entre aspas valor com retorno de carro (\\r)', () => {
    const csv = trocasParaCsv([{ ...BASE, operadorNome: 'Ana\rBia' }])
    expect(csv).toContain('"Ana\rBia"')
  })

  it('protege célula que começa com =, +, -, @ contra fórmula', () => {
    const csv = trocasParaCsv([{ ...BASE, roloSaida: '=SOMA(A1:A2)', roloEntrada: '+1', snInicial: '@sn', operadorNome: '-Ana' }])
    expect(csv).toContain(";'=SOMA(A1:A2);'+1;'@sn;")
    expect(csv).toContain(";'-Ana;")
  })

  it('deixa o Colaborador vazio quando ninguém foi informado', () => {
    expect(trocasParaCsv([{ ...BASE, colaborador: '' }]).trimEnd().endsWith(';Ana;')).toBe(true)
  })

  it('deixa a coluna Máquina vazia no PTH e preenchida no SMD', () => {
    const pth = trocasParaCsv([{ ...BASE, processo: 'PTH', bloco: 'B', maquina: null, posicao: '2', feeder: '1' }])
    expect(pth).toContain(';PTH;1;B;;TOP;')
    expect(trocasParaCsv([BASE])).toContain(';SMD;1;A;YSM10;TOP;')
  })
})
