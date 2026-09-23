import { describe, it, expect } from 'vitest'
import { validarRegra, type EntradaRegra } from '../regra'

/**
 * Regra de aprovação válida. `canais` são os canais DA CONVERSA PRIVADA — o aviso em canal é sempre
 * do Discord (DISCORD_CANAL_ID) e não depende deles.
 */
const BASE: EntradaRegra = {
  tipo: 'aprovacao',
  nome: 'Teste abaixo de 90',
  postos: ['Teste'],
  taxaMinima: '90',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: '',
  canais: ['telegram'],
  destinatarios: ['u1'],
  ativa: true,
}

describe('validarRegra — como avisar', () => {
  it('sem dizer nada, avisa na conversa privada e não avisa canal (o comportamento de antes)', () => {
    const r = validarRegra(BASE)
    expect(r.ok && r.valor.avisarPessoas).toBe(true)
    expect(r.ok && r.valor.avisarCanal).toBe(false)
    expect(r.ok && r.valor.canais).toEqual(['telegram'])
  })

  it('os dois desligados: a regra não avisaria ninguém', () => {
    expect(validarRegra({ ...BASE, avisarPessoas: false, avisarCanal: false })).toEqual({
      ok: false,
      erro: 'Escolha avisar na conversa privada, no canal do Discord, ou os dois.',
    })
  })

  it('conversa privada marcada exige pelo menos 1 canal dela', () => {
    expect(validarRegra({ ...BASE, canais: [], avisarPessoas: true, avisarCanal: true })).toEqual({
      ok: false,
      erro: 'Marque pelo menos 1 canal da conversa privada: Telegram ou Discord.',
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

describe('validarRegra — os canais gravados são os da conversa privada', () => {
  it('avisar no canal NÃO exige nada dos canais da conversa privada', () => {
    // Privado só no Telegram + canal do Discord: `canais` fica {telegram}, e o fan-out de pessoa
    // continua saindo só pelo Telegram (nada de DM de Discord que ninguém pediu).
    const r = validarRegra({ ...BASE, canais: ['telegram'], avisarPessoas: true, avisarCanal: true })
    expect(r.ok).toBe(true)
    expect(r.ok && r.valor.canais).toEqual(['telegram'])
    expect(r.ok && r.valor.avisarCanal).toBe(true)
  })

  it('privado nos dois canais + canal', () => {
    const r = validarRegra({ ...BASE, canais: ['discord', 'telegram'], avisarPessoas: true, avisarCanal: true })
    expect(r.ok && r.valor.canais).toEqual(['telegram', 'discord'])
  })

  it('só no canal: grava canais = {discord} (o cardinality > 0 da 0113) sem o gestor saber disso', () => {
    // O que o gestor marcou: só "No canal do Discord". Os canais da conversa privada, que ele nem
    // viu (a sub-lista some), não podem fazer o insert ser recusado.
    const r = validarRegra({ ...BASE, canais: [], avisarPessoas: false, avisarCanal: true })
    expect(r.ok).toBe(true)
    expect(r.ok && r.valor.canais).toEqual(['discord'])
    expect(r.ok && r.valor.avisarPessoas).toBe(false)
  })

  it('só no canal: o que estava marcado no privado é descartado', () => {
    const r = validarRegra({ ...BASE, canais: ['telegram'], avisarPessoas: false, avisarCanal: true })
    expect(r.ok && r.valor.canais).toEqual(['discord'])
  })
})
