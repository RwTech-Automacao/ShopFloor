import { describe, it, expect } from 'vitest'
import { resumoJanelaRegra, resumoLimite, validarRegra, type EntradaRegra } from '../regra'
import { postoServeAoTipo } from '../postos-regra'
import { NOME_TIPO_REGRA, ehTipoRegra } from '../tipos'

function entrada(o: Partial<EntradaRegra> = {}): EntradaRegra {
  return {
    modulo: 'sat',
    tipo: 'sat_entrada',
    nome: 'Entrada no SAT',
    postos: [],
    taxaMinima: '',
    janelaTipo: '',
    janelaValor: null,
    minimoBipes: '',
    lembreteMin: null,
    canais: ['telegram'],
    destinatarios: ['u1'],
    ativa: true,
    ...o,
  }
}

describe('validarRegra no tipo sat_entrada (Entrada no SAT)', () => {
  it('é um tipo conhecido, com nome', () => {
    expect(ehTipoRegra('sat_entrada')).toBe(true)
    expect(NOME_TIPO_REGRA.sat_entrada).toBe('Entrada no SAT')
  })

  it('aceita sem posto, sem PMO, sem janela, sem limite e sem lembrete (os mesmos campos do fim de EMB)', () => {
    const r = validarRegra(entrada({ postos: ['TESTE'], pmos: ['PMOX'], janelaTipo: 'tempo' }))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.modulo).toBe('sat')
    expect(r.valor.postos).toEqual([])
    expect(r.valor.pmos).toEqual([])
    expect(r.valor.janelaTipo).toBe('op')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.lembreteMin).toBeNull()
    expect(r.valor.horaResumo).toBeNull()
    expect(r.valor.limiteTempoSeg).toBeNull()
    expect(r.valor.limiteOcorrencias).toBeNull()
    expect(r.valor.pausaMaxMin).toBeNull()
    expect(r.valor.intervalos).toEqual([])
  })

  it('recusa campo que não é dele em vez de ignorar em silêncio', () => {
    for (const campo of [{ taxaMinima: '90' }, { janelaValor: '60' }, { minimoBipes: '5' }, { lembreteMin: '30' }]) {
      expect(validarRegra(entrada(campo))).toEqual({ ok: false, erro: 'O aviso de entrada no SAT não usa este campo.' })
    }
  })

  it('só existe no módulo SAT, e o SAT só tem ele', () => {
    expect(validarRegra(entrada({ modulo: 'shopfloor' })).ok).toBe(false)
    expect(validarRegra(entrada({ modulo: 'recebimento' })).ok).toBe(false)
    expect(validarRegra(entrada({ tipo: 'emb' })).ok).toBe(false)
  })

  it('continua exigindo responsável e canal', () => {
    expect(validarRegra(entrada({ destinatarios: [] })).ok).toBe(false)
    expect(validarRegra(entrada({ canais: [] })).ok).toBe(false)
  })

  it('a lista mostra o gatilho, não uma janela/limite de fachada', () => {
    const v = { tipo: 'sat_entrada' as const, janelaTipo: 'op' as const, janelaValor: null, horaResumo: null }
    expect(resumoJanelaRegra(v)).toBe('Quando uma NF entra ou muda no SAT')
    expect(resumoLimite({ tipo: 'sat_entrada', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: null }))
      .toBe('Um aviso por NF registrada, corrigida ou trocada')
  })

  it('nenhum posto serve à regra (o formulário não pergunta posto)', () => {
    const posto = { chave: 'TESTE', temStatus: true, coletaDefeito: true, almoxarifado: true } as never
    expect(postoServeAoTipo('sat_entrada', posto)).toBe(false)
  })
})
