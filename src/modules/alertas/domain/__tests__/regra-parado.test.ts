import { describe, expect, it } from 'vitest'
import {
  LIMITE_HORAS_MAX,
  LIMITE_HORAS_PADRAO,
  resumoJanelaRegra,
  resumoLimite,
  validarRegra,
  type EntradaRegra,
} from '../regra'

const BASE: EntradaRegra = {
  modulo: 'shopfloor',
  tipo: 'parado',
  nome: 'Parado ou travado',
  postos: ['Teste'],
  taxaMinima: '',
  janelaTipo: '',
  janelaValor: null,
  minimoBipes: '',
  limiteHoras: 2,
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  ativa: true,
}

const MSG_LIMITE = 'Informe o limite em horas (de 1 a 720).'

function erroDe(e: EntradaRegra): string | null {
  const r = validarRegra(e)
  return r.ok ? null : r.erro
}

describe('validarRegra no tipo parado', () => {
  it('aceita e sai com janela de fachada e só os campos dele', () => {
    const r = validarRegra({ ...BASE, lembreteMin: '30' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.tipo).toBe('parado')
    expect(r.valor.limiteHoras).toBe(2)
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.limiteTempoSeg).toBeNull()
    expect(r.valor.limiteOcorrencias).toBeNull()
    expect(r.valor.pausaMaxMin).toBeNull()
    expect(r.valor.horaResumo).toBeNull()
    expect(r.valor.lembreteMin).toBe(30)
    expect(r.valor.intervalos).toEqual([])
    // sem escolha, o padrão é o mais conservador: só OPs ativas, e as reprovadas entram
    expect(r.valor.soOpsAtivas).toBe(true)
    expect(r.valor.incluirManutencao).toBe(true)
  })

  it('as constantes do limite', () => {
    expect(LIMITE_HORAS_MAX).toBe(720)
    expect(LIMITE_HORAS_PADRAO).toBe(24)
  })

  it('guarda as duas opções que o gestor escolheu', () => {
    const r = validarRegra({ ...BASE, soOpsAtivas: false, incluirManutencao: false })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.soOpsAtivas).toBe(false)
      expect(r.valor.incluirManutencao).toBe(false)
    }
  })

  it('os outros tipos saem com as opções neutras (true), qualquer que seja a entrada', () => {
    const r = validarRegra({
      modulo: 'shopfloor', tipo: 'tempo', nome: 'T', postos: ['Teste'], janelaTipo: 'tempo', janelaValor: '60',
      limiteTempo: '2:00', minimoBipes: '10', taxaMinima: '', lembreteMin: null, canais: ['telegram'],
      destinatarios: ['u1'], ativa: true, soOpsAtivas: false, incluirManutencao: false,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.soOpsAtivas).toBe(true)
      expect(r.valor.incluirManutencao).toBe(true)
    }
  })

  it('aceita o limite de 1 a 720 (30 dias), inclusive como texto', () => {
    for (const v of [1, 2, 72, 168, 720, '1', '720']) {
      const r = validarRegra({ ...BASE, limiteHoras: v })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.valor.limiteHoras).toBe(Number(v))
    }
  })

  it('recusa o limite ausente, 0, 73, 1,5 e texto', () => {
    for (const v of [undefined, null, '', 0, 721, 1.5, '1,5', 'abc']) {
      expect(erroDe({ ...BASE, limiteHoras: v })).toBe(MSG_LIMITE)
    }
  })

  it('recusa zero postos, como as demais', () => {
    expect(erroDe({ ...BASE, postos: [] })).toBe('Escolha pelo menos 1 posto.')
  })

  it('turnos são opcionais: sem turno é relógio corrido', () => {
    for (const intervalos of [undefined, []]) {
      const r = validarRegra({ ...BASE, intervalos })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.valor.intervalos).toEqual([])
    }
  })

  it('aceita turnos, ordenados, e o erro de turno vira o erro da regra', () => {
    const r = validarRegra({
      ...BASE,
      intervalos: [{ inicio: '13:30', fim: '17:30' }, { inicio: '07:00', fim: '12:00' }],
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.intervalos).toEqual([
        { inicio: '07:00', fim: '12:00' },
        { inicio: '13:30', fim: '17:30' },
      ])
    }
    expect(erroDe({ ...BASE, intervalos: [{ inicio: '12:00', fim: '07:00' }] })).toMatch(/horário final/)
    expect(erroDe({ ...BASE, intervalos: [{ inicio: 'x', fim: '07:00' }] })).toMatch(/HH:MM/)
  })

  it('aceita o filtro de PMOs', () => {
    const r = validarRegra({ ...BASE, pmos: ['PMOA', 'PMOA', 'PMOB'] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.valor.pmos).toEqual(['PMOA', 'PMOB'])
  })

  it('ignora a janela que o formulário mandar', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'intervalos', janelaValor: '60' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.valor.janelaTipo).toBe('op')
      expect(r.valor.janelaValor).toBeNull()
    }
  })

  it('continua exigindo responsável e canal', () => {
    expect(erroDe({ ...BASE, destinatarios: [] })).toBe('Escolha pelo menos 1 responsável.')
    expect(erroDe({ ...BASE, canais: [] })).toMatch(/canal/)
  })
})

describe('colunas da lista no tipo parado', () => {
  const regra = { tipo: 'parado' as const, janelaTipo: 'op' as const, janelaValor: null, horaResumo: null }
  const medidas = { taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: null }
  it('Limite mostra as horas, de expediente quando a regra tem turno', () => {
    expect(resumoLimite({ ...regra, ...medidas, limiteHoras: 3, intervalos: [{ inicio: '07:00', fim: '17:00' }] }))
      .toBe('Parado há mais de 3 h de expediente')
    expect(resumoLimite({ ...regra, ...medidas, limiteHoras: 3, intervalos: [] })).toBe('Parado há mais de 3 h')
    expect(resumoLimite({ ...regra, ...medidas, limiteHoras: 3 })).toBe('Parado há mais de 3 h')
  })
  it('Limite de dias redondos mostra os dias entre parênteses (relógio corrido)', () => {
    expect(resumoLimite({ ...regra, ...medidas, limiteHoras: 168, intervalos: [] })).toBe('Parado há mais de 168 h (7 dias)')
    expect(resumoLimite({ ...regra, ...medidas, limiteHoras: 24, intervalos: [] })).toBe('Parado há mais de 24 h (1 dia)')
  })
  it('Janela mostra o que a regra olha', () => {
    expect(resumoJanelaRegra(regra)).toBe('Peças paradas em qualquer posto, sem terminar')
  })
})
