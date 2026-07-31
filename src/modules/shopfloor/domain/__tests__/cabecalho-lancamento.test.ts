import { describe, it, expect } from 'vitest'
import { resolverOpPorSn } from '../cabecalho-lancamento'

const O = (cliente: string, pmo: string, op: string, sn_ini: string, sn_fim: string) => ({ cliente, pmo, op, sn_ini, sn_fim })
const ORDS = [
  O('C1', 'PMOA', '8801', 'A100', 'A199'),
  O('C1', 'PMOB', '8802', 'B100', 'B199'),
  O('C1', 'PMOC', '8803', '', ''), // sem faixa → ignorada
]

describe('resolverOpPorSn', () => {
  it('SN dentro da faixa de UMA OP → ok com a OP', () => {
    expect(resolverOpPorSn(ORDS, 'A150')).toEqual({ ok: true, ordem: ORDS[0] })
    expect(resolverOpPorSn(ORDS, 'B100')).toEqual({ ok: true, ordem: ORDS[1] })
  })
  it('SN fora de todas as faixas → SEM_OP', () => {
    expect(resolverOpPorSn(ORDS, 'Z999')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('SN vazio → SEM_OP', () => {
    expect(resolverOpPorSn(ORDS, '')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('OP sem faixa (sn_ini/fim vazios) é ignorada', () => {
    // nada casa a PMOC (sem faixa); um SN qualquer fora de A/B → SEM_OP
    expect(resolverOpPorSn([O('C1', 'PMOC', '8803', '', '')], 'A150')).toEqual({ ok: false, erro: 'SEM_OP' })
  })
  it('SN em duas faixas sobrepostas → AMBIGUO', () => {
    const dup = [O('C1', 'PMOA', '8801', 'A100', 'A199'), O('C1', 'PMOA', '8809', 'A100', 'A199')]
    expect(resolverOpPorSn(dup, 'A150')).toEqual({ ok: false, erro: 'AMBIGUO' })
  })
})
