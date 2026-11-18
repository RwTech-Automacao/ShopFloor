import { describe, expect, it } from 'vitest'
import { mensagemErroDeTrecho } from '../erros-trecho'

describe('mensagemErroDeTrecho', () => {
  it('traduz cada código das funções de trecho (0184)', () => {
    expect(mensagemErroDeTrecho({ message: 'SEM_TRECHO' })).toBe('A OP precisa de pelo menos um trecho.')
    expect(mensagemErroDeTrecho({ message: 'TRECHO_SEQ_REPETIDO' })).toBe('Dois trechos estão com o mesmo número de ordem.')
    expect(mensagemErroDeTrecho({ message: 'PMO_NAO_E_ULTIMO' })).toBe('A OP da PMO tem que ser o último trecho.')
    expect(mensagemErroDeTrecho({ message: 'TRECHO_SEM_POSTO:PRT410' })).toBe('O trecho PRT410 ficaria sem posto.')
    expect(mensagemErroDeTrecho({ message: 'POSTO_REPETIDO:Teste' })).toBe('O posto "Teste" está em mais de um trecho.')
    expect(mensagemErroDeTrecho(new Error('TRECHO_SEM_FAIXA:PRT410'))).toBe('O trecho PRT410 ficaria sem faixa de SN.')
  })
  it('o resto não é erro de trecho', () => {
    expect(mensagemErroDeTrecho({ code: '23505', message: 'duplicate' })).toBeNull()
    expect(mensagemErroDeTrecho(new Error('rede'))).toBeNull()
    expect(mensagemErroDeTrecho(null)).toBeNull()
    expect(mensagemErroDeTrecho({ message: 'SEM_TRECHO_X' })).toBeNull()
  })
})
