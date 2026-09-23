import { describe, it, expect } from 'vitest'
import { validarRegra, type EntradaRegra } from '../regra'

/** Regra de aprovação válida, com Discord marcado (é o canal que o aviso em canal exige). */
const BASE: EntradaRegra = {
  tipo: 'aprovacao',
  nome: 'Teste abaixo de 90',
  postos: ['Teste'],
  taxaMinima: '90',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: '',
  canais: ['discord'],
  destinatarios: ['u1'],
  ativa: true,
}

describe('validarRegra — como avisar (canal do Discord)', () => {
  it('sem dizer nada, avisa as pessoas e não avisa canal (o comportamento de antes)', () => {
    const r = validarRegra(BASE)
    expect(r.ok && r.valor.avisarPessoas).toBe(true)
    expect(r.ok && r.valor.avisarCanal).toBe(false)
  })

  it('só no canal: pessoas desligadas, canal ligado', () => {
    const r = validarRegra({ ...BASE, avisarPessoas: false, avisarCanal: true })
    expect(r.ok && r.valor.avisarPessoas).toBe(false)
    expect(r.ok && r.valor.avisarCanal).toBe(true)
  })

  it('os dois ligados', () => {
    const r = validarRegra({ ...BASE, avisarPessoas: true, avisarCanal: true })
    expect(r.ok && r.valor.avisarCanal).toBe(true)
  })

  it('avisar no canal exige o canal Discord marcado', () => {
    expect(validarRegra({ ...BASE, canais: ['telegram'], avisarCanal: true })).toEqual({
      ok: false,
      erro: 'Avisar no canal exige o canal Discord marcado (o canal é do Discord).',
    })
    // Com os dois canais, passa.
    expect(validarRegra({ ...BASE, canais: ['telegram', 'discord'], avisarCanal: true }).ok).toBe(true)
  })

  it('os dois desligados: a regra não avisaria ninguém', () => {
    expect(validarRegra({ ...BASE, avisarPessoas: false, avisarCanal: false })).toEqual({
      ok: false,
      erro: 'Escolha avisar os responsáveis, o canal do Discord, ou os dois.',
    })
  })

  it('responsável continua obrigatório, mesmo avisando só no canal', () => {
    // Sem responsável, o botão "Resolvido" apareceria no canal sem ninguém que possa apertar.
    expect(validarRegra({ ...BASE, destinatarios: [], avisarPessoas: false, avisarCanal: true })).toEqual({
      ok: false,
      erro: 'Escolha pelo menos 1 responsável.',
    })
  })
})
