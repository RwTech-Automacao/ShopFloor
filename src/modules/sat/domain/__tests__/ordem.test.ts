import { describe, expect, it } from 'vitest'
import {
  agruparPorEtapa, codigoDoProduto, ehEtapa, ehTipo, rotuloTipo, ROTULO_ETAPA, tempoDesde,
  validarCorrecaoEtapa, validarDefeito, validarLaudo, validarPeca, validarTrocaNs,
} from '../ordem'

const UUID = '00000000-0000-0000-0000-0000000000d1'

describe('etapas e tipos', () => {
  it('reconhece só as etapas desta entrega', () => {
    expect(ehEtapa('em_manutencao')).toBe(true)
    expect(ehEtapa('expedicao')).toBe(false)
    expect(ROTULO_ETAPA.disponivel).toBe('Disponível para manutenção')
    expect(ROTULO_ETAPA.nota_pendente).toBe('Nota pendente')
  })
  it('tipo sem garantia definida vira "Garantia a definir"', () => {
    expect(rotuloTipo(null)).toBe('Garantia a definir')
    expect(rotuloTipo('em_garantia')).toBe('Em garantia')
    expect(rotuloTipo('fora_garantia')).toBe('Fora da garantia')
    expect(ehTipo('remanufatura')).toBe(true)
    expect(ehTipo('a_definir')).toBe(false)
  })
})

describe('agruparPorEtapa', () => {
  it('as 4 colunas da fila na ordem do fluxo; "Recebido" só aparece se tiver OS', () => {
    const ordens = [
      { id: 'a', etapa: 'em_manutencao' as const }, { id: 'b', etapa: 'nota_pendente' as const },
      { id: 'c', etapa: 'em_manutencao' as const },
    ]
    const colunas = agruparPorEtapa(ordens)
    expect(colunas.map((c) => c.etapa)).toEqual(['nota_pendente', 'disponivel', 'em_manutencao', 'qualidade'])
    expect(colunas.find((c) => c.etapa === 'em_manutencao')!.ordens.map((o) => o.id)).toEqual(['a', 'c'])
    expect(colunas.find((c) => c.etapa === 'disponivel')!.ordens).toEqual([])
    expect(agruparPorEtapa([{ id: 'x', etapa: 'recebido' as const }])[0]).toMatchObject({ etapa: 'recebido', rotulo: 'Recebido' })
  })
})

describe('tempoDesde', () => {
  const agora = Date.parse('2026-11-26T15:00:00Z')
  it('minutos, horas e dias', () => {
    expect(tempoDesde('2026-11-26T14:48:00Z', agora)).toBe('12 min')
    expect(tempoDesde('2026-11-26T10:00:00Z', agora)).toBe('5 h')
    expect(tempoDesde('2026-11-23T15:00:00Z', agora)).toBe('3 d')
    expect(tempoDesde('2026-11-26T15:00:30Z', agora)).toBe('0 min')
    expect(tempoDesde('lixo', agora)).toBe('—')
  })
})

describe('codigoDoProduto', () => {
  it('maiúsculo e sem espaço; texto livre não é código', () => {
    expect(codigoDoProduto(' pmoc31 ')).toBe('PMOC31')
    expect(codigoDoProduto('REP iDClass')).toBeNull()
    expect(codigoDoProduto('')).toBeNull()
    expect(codigoDoProduto('123')).toBeNull()
  })
})

describe('validações da manutenção', () => {
  it('defeito: id válido e solução de 1 a 2000', () => {
    expect(validarDefeito({ defeitoId: UUID, solucao: '  Trocada a fonte ' })).toEqual({ ok: true, valor: { defeitoId: UUID, solucao: 'Trocada a fonte' } })
    expect(validarDefeito({ defeitoId: 'x', solucao: 'a' })).toEqual({ ok: false, erro: 'Escolha o defeito da lista.' })
    expect(validarDefeito({ defeitoId: UUID, solucao: '  ' })).toEqual({ ok: false, erro: 'Descreva a solução do defeito.' })
    expect(validarDefeito({ defeitoId: UUID, solucao: 'x'.repeat(2001) }).ok).toBe(false)
  })
  it('peça: código maiúsculo, quantidade com vírgula, de 0 a 9999 (exclusive o zero)', () => {
    expect(validarPeca({ codigo: ' pmoe74 ', descricao: ' Módulo ', quantidade: '1,5' }))
      .toEqual({ ok: true, valor: { codigo: 'PMOE74', descricao: 'Módulo', quantidade: 1.5 } })
    expect(validarPeca({ codigo: 'PRT 1', descricao: '', quantidade: 1 })).toEqual({ ok: false, erro: 'Código do item inválido.' })
    expect(validarPeca({ codigo: 'PRT1', descricao: '', quantidade: '0' })).toEqual({ ok: false, erro: 'Quantidade inválida (maior que zero, até 9999).' })
    expect(validarPeca({ codigo: 'PRT1', descricao: '', quantidade: 'abc' }).ok).toBe(false)
    expect(validarPeca({ codigo: 'PRT1', descricao: 'x'.repeat(301), quantidade: 1 }).ok).toBe(false)
  })
  it('laudo: até 4000, limpo', () => {
    expect(validarLaudo('  ok  ')).toEqual({ ok: true, valor: 'ok' })
    expect(validarLaudo('x'.repeat(4001))).toEqual({ ok: false, erro: 'O laudo passa de 4000 caracteres.' })
  })
  it('troca de NS: normaliza como na entrada', () => {
    expect(validarTrocaNs('00043005620019177')).toEqual({ ok: true, valor: { escrito: '00043005620019177', modelo: '562', sequencia: '19177' } })
    expect(validarTrocaNs('   ')).toEqual({ ok: false, erro: 'Informe o número de série novo.' })
  })
  it('correção de etapa: etapa válida e motivo de 3 a 500', () => {
    expect(validarCorrecaoEtapa('em_manutencao', '  voltou   da qualidade ')).toEqual({ ok: true, valor: { etapa: 'em_manutencao', motivo: 'voltou da qualidade' } })
    expect(validarCorrecaoEtapa('expedicao', 'abc')).toEqual({ ok: false, erro: 'Etapa inválida.' })
    expect(validarCorrecaoEtapa('qualidade', 'ab')).toEqual({ ok: false, erro: 'Escreva o motivo da correção (3 a 500 caracteres).' })
  })
})
