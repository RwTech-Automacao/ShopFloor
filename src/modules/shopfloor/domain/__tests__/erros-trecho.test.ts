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
  it('traduz os códigos da edição por trecho (0194)', () => {
    expect(mensagemErroDeTrecho({ message: 'POSTO_COM_REGISTROS:SPI' })).toBe('O posto "SPI" já tem registros nesta OP e não pode trocar de trecho.')
    expect(mensagemErroDeTrecho({ message: 'PRT_COM_HISTORICO:PRT410' })).toMatch(/^PRT410 já tem peças .* posto final nem a série/)
    expect(mensagemErroDeTrecho({ message: 'PRT_FAIXA_COM_HISTORICO:PRT410' })).toMatch(/^PRT410 já tem peças .* SNs já usados\.$/)
    expect(mensagemErroDeTrecho({ message: 'FAIXA_SOBREPOSTA:PMOC14' })).toBe('Uma faixa de SN do trecho PMOC14 se sobrepõe a outra faixa da OP.')
    expect(mensagemErroDeTrecho({ message: 'FAIXA_INVALIDA:PRT410' })).toMatch(/^Faixa de SN inválida no trecho PRT410/)
    expect(mensagemErroDeTrecho({ message: 'SN_MODO_INVALIDO:PRT410' })).toBe('Série inválida no trecho PRT410.')
    expect(mensagemErroDeTrecho({ message: 'ALMOXARIFADO_FORA_DO_FIM' })).toBe('O Almoxarifado tem que ser o último posto do trecho da PMO.')
    expect(mensagemErroDeTrecho({ message: 'TRECHOS_DIFERENTES' })).toMatch(/^Os trechos da tela não batem/)
    expect(mensagemErroDeTrecho({ message: 'OP_SEM_TRECHOS' })).toBe('Esta OP não tem trechos do Compels.')
    expect(mensagemErroDeTrecho({ message: 'ALMOXARIFADO_REPETIDO' })).toBe('A rota só pode ter um posto de Almoxarifado.')
    expect(mensagemErroDeTrecho({ message: 'CLIENTE_VAZIO' })).toBe('Informe o cliente.')
    expect(mensagemErroDeTrecho({ message: 'QTD_INVALIDA' })).toMatch(/^A quantidade tem que ser/)
    expect(mensagemErroDeTrecho({ message: 'PLACAS_INVALIDAS' })).toMatch(/^Placas por painel tem que ser/)
    expect(mensagemErroDeTrecho({ message: 'PLACAS_COM_REGISTROS' })).toMatch(/^Esta OP já tem registros/)
  })
  it('traduz a recusa de PRT na receita (0195)', () => {
    expect(mensagemErroDeTrecho({ message: 'RECEITA_PRT_INVALIDA:PRT420' }))
      .toBe('PRT420 não pode estar na receita da Integração: só entra PRT desta OP com série própria.')
  })
  it('traduz a recusa da PRT incluída de novo (0199)', () => {
    expect(mensagemErroDeTrecho({ message: 'PRT_INCLUIDA_FORA_DA_CADEIA:PRT420' }))
      .toBe('PRT420 não é uma PRT desta OP no Compels. Recarregue a página e tente de novo.')
    expect(mensagemErroDeTrecho({ message: 'PRT_INCLUIDA_REPETIDA:PRT420' })).toBe('PRT420 já é um trecho desta OP.')
    expect(mensagemErroDeTrecho({ message: 'PRT_INCLUIDA_COM_REGISTROS:PRT420' }))
      .toBe('PRT420 não pode voltar com esses postos: algum deles já tem peças bipadas nesta OP.')
  })
  it('o resto não é erro de trecho', () => {
    expect(mensagemErroDeTrecho({ code: '23505', message: 'duplicate' })).toBeNull()
    expect(mensagemErroDeTrecho(new Error('rede'))).toBeNull()
    expect(mensagemErroDeTrecho(null)).toBeNull()
    expect(mensagemErroDeTrecho({ message: 'SEM_TRECHO_X' })).toBeNull()
  })
})
