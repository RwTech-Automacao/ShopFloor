import { describe, it, expect } from 'vitest'
import {
  MENSAGEM_SERIE_EXIGE_LOTE,
  amostraCompleta,
  conferirBipeAmostra,
  mensagemRecusaLote,
  type NecessidadeLote,
} from '../almoxarifado'
import { ehEntradaDeLoteAlmoxarifado } from '../cancelamento'

const LOTE: NecessidadeLote = {
  loteId: 'l1', rotulo: 'LOTE[abcd1234][5]', pecas: 5, amostra: 2,
  sns: ['7001', '7002', '7003', '7004', '7005'], jaLancadas: 0, aprovadoEm: null,
}

describe('serie_exige_lote (0156)', () => {
  it('a frase do bipe avulso na OP individual com NQA no anterior', () => {
    expect(MENSAGEM_SERIE_EXIGE_LOTE).toBe('Esta peça faz parte de um lote do NQA: confirme o lote inteiro.')
  })
})

describe('conferirBipeAmostra', () => {
  it('aceita SN do lote e devolve a amostra com ele (normalizado)', () => {
    expect(conferirBipeAmostra(LOTE, [], ' 0007-001 ')).toEqual({ ok: true, bipados: ['7001'] })
  })

  it('SN de fora do lote é recusado e não entra na amostra', () => {
    expect(conferirBipeAmostra(LOTE, ['7001'], '7099')).toEqual({ ok: false, motivo: 'fora_do_lote', sn: '7099' })
  })

  it('repetido não conta duas vezes', () => {
    expect(conferirBipeAmostra(LOTE, ['7001'], '7001')).toEqual({ ok: false, motivo: 'repetido', sn: '7001' })
  })

  it('amostra já completa não aceita mais SN', () => {
    expect(conferirBipeAmostra(LOTE, ['7001', '7002'], '7003')).toEqual({ ok: false, motivo: 'completa', sn: '7003' })
  })

  it('bipe vazio não faz nada', () => {
    expect(conferirBipeAmostra(LOTE, [], '   ')).toEqual({ ok: false, motivo: 'vazio', sn: '' })
  })
})

describe('amostraCompleta', () => {
  it('só com exatamente K SNs distintos', () => {
    expect(amostraCompleta(LOTE, ['7001'])).toBe(false)
    expect(amostraCompleta(LOTE, ['7001', '7002'])).toBe(true)
  })

  it('amostra inválida (nula ou 0) nunca completa', () => {
    expect(amostraCompleta({ ...LOTE, amostra: null }, [])).toBe(false)
    expect(amostraCompleta({ ...LOTE, amostra: 0 }, [])).toBe(false)
  })
})

describe('mensagemRecusaLote', () => {
  it('sem_permissao não depende do detalhe', () => {
    expect(mensagemRecusaLote('sem_permissao')).toBe('Você não tem permissão para esta ação.')
  })

  it('motivos com frase pronta da RPC usam o detalhe', () => {
    for (const motivo of [
      'ja_lancado', 'lote_com_sn_lancado', 'amostra_fora_do_lote', 'amostra_tamanho_errado',
      'amostra_nqa_invalida', 'lote_nao_aprovado', 'lote_nao_encontrado', 'posto_fora_da_op',
    ]) {
      expect(mensagemRecusaLote(motivo, 'Frase da RPC.')).toBe('Frase da RPC.')
    }
  })

  it('sem detalhe, cada motivo tem uma frase própria (nunca só "erro")', () => {
    expect(mensagemRecusaLote('ja_lancado')).toBe('Este lote já foi confirmado.')
    expect(mensagemRecusaLote('lote_com_sn_lancado')).toBe(
      'Alguma peça deste lote já tem entrada no Almoxarifado. Cancele essa entrada em Registros e confirme o lote outra vez.',
    )
    expect(mensagemRecusaLote('amostra_fora_do_lote')).toBe('Uma das peças bipadas não é deste lote.')
    expect(mensagemRecusaLote('amostra_tamanho_errado')).toBe('A quantidade de peças da amostra não confere com a Tabela NQA.')
    expect(mensagemRecusaLote('amostra_nqa_invalida')).toBe(
      'A Tabela NQA não tem amostra para o tamanho deste lote. Peça ao gestor para conferir a Tabela NQA.',
    )
    expect(mensagemRecusaLote('lote_nao_aprovado')).toBe('Este lote não foi aprovado no NQA.')
    expect(mensagemRecusaLote('lote_nao_encontrado')).toBe('Lote não encontrado nesta OP.')
    expect(mensagemRecusaLote('lote_nao_se_aplica')).toBe('Nesta OP a entrada não é por lote do NQA.')
    expect(mensagemRecusaLote('posto_invalido')).toBe('Este posto não é um posto de Almoxarifado.')
    expect(mensagemRecusaLote('qualquer_outro')).toBe('Não foi possível confirmar o lote.')
  })
})

describe('ehEntradaDeLoteAlmoxarifado', () => {
  it('só posto de perfil almoxarifado com envio_id', () => {
    expect(ehEntradaDeLoteAlmoxarifado('almoxarifado', 'e1')).toBe(true)
    expect(ehEntradaDeLoteAlmoxarifado('almoxarifado', null)).toBe(false)
    expect(ehEntradaDeLoteAlmoxarifado('almoxarifado', '')).toBe(false)
    expect(ehEntradaDeLoteAlmoxarifado('caixa', 'e1')).toBe(false)
    expect(ehEntradaDeLoteAlmoxarifado(null, 'e1')).toBe(false)
  })
})
