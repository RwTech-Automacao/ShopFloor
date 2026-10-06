import { describe, it, expect } from 'vitest'
import {
  corteParaDias,
  ehOpFinalizada,
  montarOpsAtivas,
  paraIsoUtc,
  ultimoBipePorOp,
  validarDias,
  type LinhaBipe,
  type LinhaOrdem,
} from '../ops-ativas'

const ordem = (pmo: string, op: string, status = '', extra: Partial<LinhaOrdem> = {}): LinhaOrdem => ({
  pmo,
  op,
  cliente: 'VMI',
  descricao: 'PLACA MONTADA',
  status,
  ...extra,
})

describe('validarDias', () => {
  it('ausente ou vazio não filtra por data', () => {
    expect(validarDias(undefined)).toBeNull()
    expect(validarDias(null)).toBeNull()
    expect(validarDias('')).toBeNull()
    expect(validarDias('  ')).toBeNull()
  })

  it('aceita inteiro dentro da faixa', () => {
    expect(validarDias('30')).toBe(30)
    expect(validarDias('7')).toBe(7)
  })

  // A fronteira EXATA: 1 e 365 passam, 0 e 366 não. Testar -5 e 400 não prova nada sobre o limite.
  it('aceita a fronteira de baixo (1) e recusa o vizinho de fora (0)', () => {
    expect(validarDias('1')).toBe(1)
    expect(validarDias('0')).toBe('invalido')
  })

  it('aceita a fronteira de cima (365) e recusa o vizinho de fora (366)', () => {
    expect(validarDias('365')).toBe(365)
    expect(validarDias('366')).toBe('invalido')
  })

  it('recusa o que não é inteiro positivo na faixa', () => {
    for (const v of ['abc', '1.5', '-5', '30abc', '1e2', ' 30 abc', '+30', 'Infinity', '0x1e', '400', '-1']) {
      expect(validarDias(v), v).toBe('invalido')
    }
  })

  // '0030' é inteiro e está na faixa; recusá-lo por causa do zero à esquerda seria rigor inútil.
  it('aceita o inteiro com zero à esquerda', () => {
    expect(validarDias('0030')).toBe(30)
  })

  it('recusa o que não é texto nem ausente', () => {
    expect(validarDias(30)).toBe('invalido')
    expect(validarDias(['30'])).toBe('invalido')
    expect(validarDias({})).toBe('invalido')
  })
})

describe('ehOpFinalizada', () => {
  it('reconhece FINALIZADA ignorando caixa e espaços', () => {
    for (const s of ['FINALIZADA', 'finalizada', 'Finalizada', ' FINALIZADA ', 'fInAlIzAdA']) {
      expect(ehOpFinalizada(s), s).toBe(true)
    }
  })

  it('qualquer outro status (inclusive vazio e ausente) é OP em andamento', () => {
    for (const s of ['', '  ', 'ABERTA', 'EM ANDAMENTO', 'FINALIZADO', 'FINALIZADAS', null, undefined]) {
      expect(ehOpFinalizada(s), String(s)).toBe(false)
    }
  })
})

describe('paraIsoUtc', () => {
  it('normaliza o que o PostgREST devolve para ISO em UTC', () => {
    expect(paraIsoUtc('2026-10-06T11:42:10.123+00:00')).toBe('2026-10-06T11:42:10.123Z')
    expect(paraIsoUtc('2026-10-06T08:42:10-03:00')).toBe('2026-10-06T11:42:10.000Z')
  })

  it('data impossível vira nulo em vez de "Invalid Date"', () => {
    expect(paraIsoUtc('')).toBeNull()
    expect(paraIsoUtc(null)).toBeNull()
    expect(paraIsoUtc('nunca')).toBeNull()
  })
})

describe('corteParaDias', () => {
  it('o corte é agora menos os dias pedidos, em UTC', () => {
    const agora = new Date('2026-10-06T12:00:00.000Z')
    expect(corteParaDias(agora, 1)).toBe('2026-10-05T12:00:00.000Z')
    expect(corteParaDias(agora, 30)).toBe('2026-09-06T12:00:00.000Z')
  })
})

describe('ultimoBipePorOp', () => {
  it('guarda o bipe MAIS RECENTE de cada OP, em qualquer ordem de entrada', () => {
    const linhas: LinhaBipe[] = [
      { pmo: 'PMOC13', op: '2340/26', data_hora: '2026-10-06T11:00:00+00:00' },
      { pmo: 'PMOC13', op: '2340/26', data_hora: '2026-10-06T11:42:10+00:00' },
      { pmo: 'PMOC13', op: '2340/26', data_hora: '2026-10-01T09:00:00+00:00' },
      { pmo: 'PMOG01', op: '8248', data_hora: '2026-09-30T10:00:00+00:00' },
    ]
    const m = ultimoBipePorOp(linhas)
    expect(m.get('PMOC13\u00002340/26')).toBe('2026-10-06T11:42:10.000Z')
    expect(m.get('PMOG01\u00008248')).toBe('2026-09-30T10:00:00.000Z')
  })

  it('OP diferente com o mesmo texto concatenado não se mistura', () => {
    // Sem separador seguro, ('A','BC') e ('AB','C') cairiam na mesma chave.
    const m = ultimoBipePorOp([
      { pmo: 'A', op: 'BC', data_hora: '2026-10-06T10:00:00+00:00' },
      { pmo: 'AB', op: 'C', data_hora: '2026-10-06T11:00:00+00:00' },
    ])
    expect(m.size).toBe(2)
  })

  it('ignora linha com data impossível', () => {
    const m = ultimoBipePorOp([{ pmo: 'PMOC13', op: '2340/26', data_hora: 'nunca' }])
    expect(m.size).toBe(0)
  })
})

describe('montarOpsAtivas', () => {
  const bipes: LinhaBipe[] = [
    { pmo: 'PMOC13', op: '2340/26', data_hora: '2026-10-06T11:42:10+00:00' },
    { pmo: 'PMOG01', op: '8248', data_hora: '2026-10-05T08:00:00+00:00' },
  ]

  it('tira as OPs finalizadas, em qualquer caixa', () => {
    const ops = montarOpsAtivas(
      [ordem('PMOC13', '2340/26'), ordem('PMOX', '1', 'FINALIZADA'), ordem('PMOY', '2', 'finalizada')],
      bipes,
      false,
    )
    expect(ops.map((o) => o.pmo)).toEqual(['PMOC13'])
  })

  it('devolve pmo, op, cliente, descricao e ultimoBipe', () => {
    const ops = montarOpsAtivas(
      [ordem('PMOC13', '2340/26', 'ABERTA', { cliente: 'VMI', descricao: 'PLACA MONTADA INDICADOR LED' })],
      bipes,
      false,
    )
    expect(ops).toEqual([
      {
        pmo: 'PMOC13',
        op: '2340/26',
        cliente: 'VMI',
        descricao: 'PLACA MONTADA INDICADOR LED',
        ultimoBipe: '2026-10-06T11:42:10.000Z',
      },
    ])
  })

  it('sem exigir bipe, a OP sem nenhum bipe entra com ultimoBipe nulo', () => {
    const ops = montarOpsAtivas([ordem('PMOZ', '9')], bipes, false)
    expect(ops).toEqual([{ pmo: 'PMOZ', op: '9', cliente: 'VMI', descricao: 'PLACA MONTADA', ultimoBipe: null }])
  })

  it('exigindo bipe, a OP sem bipe no recorte sai da lista', () => {
    const ops = montarOpsAtivas([ordem('PMOC13', '2340/26'), ordem('PMOZ', '9')], bipes, true)
    expect(ops.map((o) => o.pmo)).toEqual(['PMOC13'])
  })

  it('ordena por ultimoBipe decrescente', () => {
    const ops = montarOpsAtivas([ordem('PMOG01', '8248'), ordem('PMOC13', '2340/26')], bipes, true)
    expect(ops.map((o) => o.ultimoBipe)).toEqual([
      '2026-10-06T11:42:10.000Z',
      '2026-10-05T08:00:00.000Z',
    ])
  })

  it('as OPs SEM bipe vão para o FIM, nunca para o começo', () => {
    const ops = montarOpsAtivas(
      [ordem('SEM1', '1'), ordem('PMOG01', '8248'), ordem('SEM2', '2'), ordem('PMOC13', '2340/26')],
      bipes,
      false,
    )
    expect(ops.map((o) => o.pmo)).toEqual(['PMOC13', 'PMOG01', 'SEM1', 'SEM2'])
    expect(ops.at(-1)?.ultimoBipe).toBeNull()
    expect(ops[0]?.ultimoBipe).toBe('2026-10-06T11:42:10.000Z')
  })

  it('entre OPs sem bipe a ordem é estável por pmo e op (lista não embaralha entre chamadas)', () => {
    const entrada = [ordem('SEM2', '2'), ordem('SEM1', '9'), ordem('SEM1', '10')]
    const ops = montarOpsAtivas(entrada, [], false)
    expect(ops.map((o) => `${o.pmo}/${o.op}`)).toEqual(['SEM1/10', 'SEM1/9', 'SEM2/2'])
  })
})
