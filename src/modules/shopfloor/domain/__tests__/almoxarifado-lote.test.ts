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
  loteId: 'l1', rotulo: 'LOTE[abcd1234][5]', pecas: 5, amostra: 5,
  sns: ['7001', '7002', '7003', '7004', '7005'], jaLancadas: 0, aprovadoEm: null,
}

describe('serie_exige_lote (0156)', () => {
  it('a frase do bipe avulso na OP individual com NQA no anterior', () => {
    expect(MENSAGEM_SERIE_EXIGE_LOTE).toBe('Esta peça faz parte de um lote do NQA: confirme o lote inteiro.')
  })
})

describe('conferirBipeAmostra', () => {
  it('aceita SN do lote e devolve os bipados com ele (normalizado)', () => {
    expect(conferirBipeAmostra(LOTE, [], ' 0007-001 ')).toEqual({ ok: true, bipados: ['7001'] })
  })

  it('SN de fora do lote é recusado e não entra nos bipados', () => {
    expect(conferirBipeAmostra(LOTE, ['7001'], '7099')).toEqual({ ok: false, motivo: 'fora_do_lote', sn: '7099' })
  })

  it('repetido não conta duas vezes', () => {
    expect(conferirBipeAmostra(LOTE, ['7001'], '7001')).toEqual({ ok: false, motivo: 'repetido', sn: '7001' })
  })

  it('com todos os SNs já bipados, qualquer outro bipe é repetido ou de fora (nunca "completa")', () => {
    const todos = LOTE.sns
    expect(conferirBipeAmostra(LOTE, todos, '7003')).toEqual({ ok: false, motivo: 'repetido', sn: '7003' })
    expect(conferirBipeAmostra(LOTE, todos, '7099')).toEqual({ ok: false, motivo: 'fora_do_lote', sn: '7099' })
  })

  it('os SNs entram um a um até o lote todo', () => {
    let bipados: string[] = []
    for (const sn of LOTE.sns) {
      const r = conferirBipeAmostra(LOTE, bipados, sn)
      expect(r.ok).toBe(true)
      if (r.ok) bipados = r.bipados
    }
    expect(bipados).toEqual(LOTE.sns)
  })

  it('bipe vazio não faz nada', () => {
    expect(conferirBipeAmostra(LOTE, [], '   ')).toEqual({ ok: false, motivo: 'vazio', sn: '' })
  })
})

describe('amostraCompleta', () => {
  it('só com TODOS os SNs do lote bipados', () => {
    expect(amostraCompleta(LOTE, [])).toBe(false)
    expect(amostraCompleta(LOTE, ['7001', '7002'])).toBe(false)
    expect(amostraCompleta(LOTE, ['7001', '7002', '7003', '7004'])).toBe(false)
    expect(amostraCompleta(LOTE, ['7005', '7004', '7003', '7002', '7001'])).toBe(true)
  })

  it('vale sns.length, mesmo que lote.amostra diga outra coisa (nulo, 0, 2)', () => {
    for (const amostra of [null, 0, 2]) {
      expect(amostraCompleta({ ...LOTE, amostra }, ['7001', '7002'])).toBe(false)
      expect(amostraCompleta({ ...LOTE, amostra }, LOTE.sns)).toBe(true)
    }
  })

  it('lote sem SN nunca completa', () => {
    expect(amostraCompleta({ ...LOTE, sns: [] }, [])).toBe(false)
  })
})

describe('mensagemRecusaLote', () => {
  it('sem_permissao não depende do detalhe', () => {
    expect(mensagemRecusaLote('sem_permissao')).toBe('Você não tem permissão para esta ação.')
  })

  it('motivos com frase pronta da RPC usam o detalhe', () => {
    for (const motivo of [
      'ja_lancado', 'lote_com_sn_lancado', 'amostra_fora_do_lote', 'lote_incompleto',
      'lote_nao_aprovado', 'lote_nao_encontrado', 'posto_fora_da_op',
    ]) {
      expect(mensagemRecusaLote(motivo, 'Frase da RPC.')).toBe('Frase da RPC.')
    }
  })

  it('lote_incompleto usa o detalhe do banco (N e F reais)', () => {
    expect(mensagemRecusaLote('lote_incompleto', 'Bipe todas as 5 peças do lote: faltam 3.'))
      .toBe('Bipe todas as 5 peças do lote: faltam 3.')
  })

  it('os motivos que sumiram do banco caem na frase genérica', () => {
    expect(mensagemRecusaLote('amostra_tamanho_errado')).toBe('Não foi possível confirmar o lote.')
    expect(mensagemRecusaLote('amostra_nqa_invalida')).toBe('Não foi possível confirmar o lote.')
  })

  it('sem detalhe, cada motivo tem uma frase própria (nunca só "erro")', () => {
    expect(mensagemRecusaLote('ja_lancado')).toBe('Este lote já foi confirmado.')
    expect(mensagemRecusaLote('lote_com_sn_lancado')).toBe(
      'Alguma peça deste lote já tem entrada no Almoxarifado. Cancele essa entrada em Registros e confirme o lote outra vez.',
    )
    expect(mensagemRecusaLote('amostra_fora_do_lote')).toBe('Uma das peças bipadas não é deste lote.')
    expect(mensagemRecusaLote('lote_incompleto')).toBe('Bipe todas as peças do lote antes de confirmar.')
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
