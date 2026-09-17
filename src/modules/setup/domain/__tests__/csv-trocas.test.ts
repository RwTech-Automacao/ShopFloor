import { describe, it, expect } from 'vitest'
import { trocasParaCsv } from '../csv-trocas'

describe('trocasParaCsv', () => {
  it('gera ; com BOM, cabeçalho e motivos juntos', () => {
    const csv = trocasParaCsv([{
      id: '1', setupId: 's', pmo: 'PMOG13', op: '9001', linha: '1', equipamento: 'YSM10', face: 'TOP',
      posicao: '36', feeder: 'ZSY-1', roloSaida: 'CAPJ41-A', roloEntrada: 'CAPJ41-B', snInicial: '2690010010',
      resultado: 'REPROVADO', motivos: ['Motivo 1.', 'Motivo; 2.'], operadorNome: 'Ana', dataHora: '2026-09-17T12:00:00Z',
    }])
    expect(csv.startsWith('﻿Data/hora;PMO;OP;Linha;Máquina/Bloco;Face;Posição;Feeder;Rolo que saiu;Rolo que entrou;SN Inicial;Resultado;Motivos;Operador\n')).toBe(true)
    expect(csv).toContain(';REPROVADO;"Motivo 1. Motivo; 2.";Ana')
  })
})
