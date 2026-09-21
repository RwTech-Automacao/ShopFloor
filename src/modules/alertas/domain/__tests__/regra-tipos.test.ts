import { describe, it, expect } from 'vitest'
import { validarRegra, validarPrevia, resumoLimite, resumoPmos, PADROES_TIPO, type EntradaRegra } from '../regra'
import { NOME_TIPO_REGRA, TIPOS_REGRA, ehTipoRegra } from '../tipos'
import { mensagemErroAlerta } from '../erros'

const COMUM = {
  nome: ' Teste  lento ',
  postos: ['Teste'],
  lembreteMin: '',
  canais: ['telegram'],
  destinatarios: ['u1'],
  ativa: true,
}

const TEMPO: EntradaRegra = {
  ...COMUM,
  tipo: 'tempo',
  taxaMinima: '',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '10',
  limiteTempo: '2:00',
  pausaMaxMin: '30',
  limiteOcorrencias: '',
  pmos: [' PMOA ', 'PMOA', 'PMOB'],
}

const DEFEITO: EntradaRegra = {
  ...COMUM,
  tipo: 'defeito',
  taxaMinima: '',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  limiteTempo: '',
  pausaMaxMin: '',
  limiteOcorrencias: '5',
  pmos: [],
}

describe('tipos de regra', () => {
  it('três tipos, com nome de tela', () => {
    expect(TIPOS_REGRA).toEqual(['aprovacao', 'tempo', 'defeito'])
    expect(NOME_TIPO_REGRA).toEqual({
      aprovacao: 'Taxa de aprovação',
      tempo: 'Tempo médio por peça',
      defeito: 'Defeito repetido',
    })
    expect(ehTipoRegra('tempo')).toBe(true)
    expect(ehTipoRegra('lua')).toBe(false)
  })
})

describe('validarRegra — tempo médio por peça', () => {
  it('valida e guarda o limite em segundos; PMOs sem repetição', () => {
    expect(validarRegra(TEMPO)).toEqual({
      ok: true,
      valor: {
        tipo: 'tempo',
        nome: 'Teste lento',
        postos: ['Teste'],
        taxaMinima: null,
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: 10,
        limiteTempoSeg: 120,
        limiteOcorrencias: null,
        pausaMaxMin: 30,
        lembreteMin: null,
        canais: ['telegram'],
        destinatarios: ['u1'],
        pmos: ['PMOA', 'PMOB'],
        ativa: true,
      },
    })
  })
  it('ignora a taxa digitada (não é campo do tipo)', () => {
    const r = validarRegra({ ...TEMPO, taxaMinima: '999' })
    expect(r.ok && r.valor.taxaMinima).toBeNull()
  })
  it('aceita a janela da OP em andamento e recusa a janela por bipes', () => {
    const r = validarRegra({ ...TEMPO, janelaTipo: 'op', janelaValor: null })
    expect(r.ok).toBe(true)
    expect(r.ok && r.valor.janelaValor).toBeNull()
    expect(validarRegra({ ...TEMPO, janelaTipo: 'bipes', janelaValor: '50' })).toEqual({
      ok: false,
      erro: 'Tempo médio por peça usa a janela por minutos ou a OP em andamento.',
    })
  })
  it('limite em mm:ss, de 0:01 a 60:00', () => {
    const erro = { ok: false, erro: 'Informe o tempo máximo por peça em mm:ss (de 0:01 a 60:00).' }
    expect(validarRegra({ ...TEMPO, limiteTempo: '2:75' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, limiteTempo: '' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, limiteTempo: '60:01' })).toEqual(erro)
    const r = validarRegra({ ...TEMPO, limiteTempo: '3' })
    expect(r.ok && r.valor.limiteTempoSeg).toBe(180)
  })
  it('pausas ignoradas de 1 a 240 minutos, mas o campo é OPCIONAL', () => {
    const erro = { ok: false, erro: 'Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.' }
    expect(validarRegra({ ...TEMPO, pausaMaxMin: '0' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, pausaMaxMin: '241' })).toEqual(erro)
    const r = validarRegra({ ...TEMPO, pausaMaxMin: '240' })
    expect(r.ok && r.valor.pausaMaxMin).toBe(240)
  })
  it('pausa vazia = nula: não descarta nenhum intervalo e não aciona o check "limite < pausa"', () => {
    const vazio = validarRegra({ ...TEMPO, pausaMaxMin: '' })
    expect(vazio.ok && vazio.valor.pausaMaxMin).toBeNull()
    // Sem pausa não há "pausa x 60" para comparar: mesmo um limite bem alto (59:59) passa.
    const limiteAlto = validarRegra({ ...TEMPO, limiteTempo: '59:59', pausaMaxMin: '' })
    expect(limiteAlto.ok && limiteAlto.valor.pausaMaxMin).toBeNull()
  })
  it('limite menor que a pausa ignorada (senão a regra nunca dispara)', () => {
    const erro = {
      ok: false,
      erro: 'O limite de tempo precisa ser menor que a pausa ignorada (senão a regra nunca dispara).',
    }
    expect(validarRegra({ ...TEMPO, limiteTempo: '30:00', pausaMaxMin: '30' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, limiteTempo: '45:00', pausaMaxMin: '30' })).toEqual(erro)
    expect(validarRegra({ ...TEMPO, limiteTempo: '1:00', pausaMaxMin: '1' })).toEqual(erro)
    const r = validarRegra({ ...TEMPO, limiteTempo: '29:59', pausaMaxMin: '30' })
    expect(r.ok && r.valor.limiteTempoSeg).toBe(1799)
  })
  it('prévia do tempo aceita a menor pausa (1 minuto)', () => {
    const r = validarPrevia({
      tipo: 'tempo',
      postos: ['Teste'],
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '10',
      pausaMaxMin: '1',
    })
    expect(r.ok && r.valor.pausaMaxMin).toBe(1)
  })
  it('mínimo de bipes: obrigatório, mesma validação e mesma mensagem da aprovação', () => {
    expect(validarRegra({ ...TEMPO, minimoBipes: '0' })).toEqual({
      ok: false,
      erro: 'O mínimo de bipes deve ser um número inteiro maior que zero.',
    })
    expect(validarRegra({ ...TEMPO, minimoBipes: '' })).toEqual({
      ok: false,
      erro: 'O mínimo de bipes deve ser um número inteiro maior que zero.',
    })
  })
})

describe('validarRegra — defeito repetido', () => {
  it('valida; o mínimo de bipes fica nulo', () => {
    expect(validarRegra(DEFEITO)).toEqual({
      ok: true,
      valor: {
        tipo: 'defeito',
        nome: 'Teste lento',
        postos: ['Teste'],
        taxaMinima: null,
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: null,
        limiteTempoSeg: null,
        limiteOcorrencias: 5,
        pausaMaxMin: null,
        lembreteMin: null,
        canais: ['telegram'],
        destinatarios: ['u1'],
        pmos: [],
        ativa: true,
      },
    })
  })
  it('só janela por minutos', () => {
    const erro = { ok: false, erro: 'Defeito repetido usa só a janela por minutos.' }
    expect(validarRegra({ ...DEFEITO, janelaTipo: 'op', janelaValor: null })).toEqual(erro)
    expect(validarRegra({ ...DEFEITO, janelaTipo: 'bipes', janelaValor: '50' })).toEqual(erro)
  })
  it('repetições: inteiro, 2 ou mais', () => {
    const erro = { ok: false, erro: 'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).' }
    expect(validarRegra({ ...DEFEITO, limiteOcorrencias: '1' })).toEqual(erro)
    expect(validarRegra({ ...DEFEITO, limiteOcorrencias: '2,5' })).toEqual(erro)
    expect(validarRegra({ ...DEFEITO, limiteOcorrencias: '' })).toEqual(erro)
    const r = validarRegra({ ...DEFEITO, limiteOcorrencias: '2' })
    expect(r.ok && r.valor.limiteOcorrencias).toBe(2)
  })
  it('a janela de minutos continua com teto de 7 dias', () => {
    expect(validarRegra({ ...DEFEITO, janelaValor: '10081' })).toEqual({
      ok: false,
      erro: 'A janela de tempo pode ter no máximo 7 dias (10080 minutos).',
    })
  })
})

describe('validarRegra — tipo', () => {
  it('tipo desconhecido é recusado', () => {
    expect(validarRegra({ ...TEMPO, tipo: 'lua' })).toEqual({ ok: false, erro: 'Escolha o tipo da regra.' })
  })
  it('sem tipo = taxa de aprovação (chamadas de antes dos tipos)', () => {
    const r = validarRegra({ ...COMUM, taxaMinima: '90', janelaTipo: 'tempo', janelaValor: '60', minimoBipes: '20' })
    expect(r.ok && r.valor.tipo).toBe('aprovacao')
    expect(r.ok && r.valor.pmos).toEqual([])
  })
})

describe('validarPrevia por tipo', () => {
  it('tempo leva a pausa e as PMOs', () => {
    expect(
      validarPrevia({
        tipo: 'tempo',
        postos: ['Teste'],
        janelaTipo: 'tempo',
        janelaValor: '60',
        minimoBipes: '10',
        pausaMaxMin: '30',
        pmos: ['PMOA'],
      }),
    ).toEqual({
      ok: true,
      valor: {
        tipo: 'tempo',
        postos: ['Teste'],
        janelaTipo: 'tempo',
        janelaValor: 60,
        minimoBipes: 10,
        pausaMaxMin: 30,
        limiteOcorrencias: null,
        pmos: ['PMOA'],
      },
    })
  })
  it('tempo aceita a pausa vazia (conta todas as pausas)', () => {
    const r = validarPrevia({
      tipo: 'tempo',
      postos: ['Teste'],
      janelaTipo: 'tempo',
      janelaValor: '60',
      minimoBipes: '10',
      pausaMaxMin: '',
    })
    expect(r.ok && r.valor.pausaMaxMin).toBeNull()
  })
  it('defeito exige as repetições', () => {
    expect(
      validarPrevia({
        tipo: 'defeito',
        postos: ['Teste'],
        janelaTipo: 'tempo',
        janelaValor: '60',
        minimoBipes: '',
        limiteOcorrencias: '1',
      }),
    ).toEqual({ ok: false, erro: 'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).' })
  })
})

describe('resumos da lista de regras', () => {
  it('limite formatado por tipo', () => {
    expect(resumoLimite({ tipo: 'aprovacao', taxaMinima: 90, limiteTempoSeg: null, limiteOcorrencias: null })).toBe('≥ 90%')
    expect(resumoLimite({ tipo: 'aprovacao', taxaMinima: 92.5, limiteTempoSeg: null, limiteOcorrencias: null })).toBe(
      '≥ 92,5%',
    )
    expect(resumoLimite({ tipo: 'tempo', taxaMinima: null, limiteTempoSeg: 120, limiteOcorrencias: null })).toBe(
      '≤ 2:00/peça',
    )
    expect(resumoLimite({ tipo: 'defeito', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: 5 })).toBe(
      '≥ 5 vezes',
    )
    expect(resumoLimite({ tipo: 'tempo', taxaMinima: null, limiteTempoSeg: null, limiteOcorrencias: null })).toBe('—')
  })
  it('PMOs: vazio = Todas', () => {
    expect(resumoPmos([])).toBe('Todas')
    expect(resumoPmos(['PMOA', 'PMOB'])).toBe('PMOA, PMOB')
  })
  it('padrões dos tipos novos', () => {
    expect(PADROES_TIPO).toEqual({
      tempo: { limiteTempo: '2:00', janelaTempo: 60, minimoBipes: 10, pausaMaxMin: 30 },
      defeito: { limiteOcorrencias: 5, janelaTempo: 60 },
    })
  })
})

describe('erros novos do banco', () => {
  it('traduz os códigos da 0115', () => {
    expect(mensagemErroAlerta('ERROR: TIPO_FIXO')).toBe('O tipo da regra não muda depois de criado.')
    expect(mensagemErroAlerta('TIPO_INVALIDO')).toBe('Escolha o tipo da regra.')
    expect(mensagemErroAlerta('PAUSA_INVALIDA')).toBe(
      'Ignorar pausas acima de: informe um número inteiro de 1 a 240 minutos.',
    )
    expect(mensagemErroAlerta('LIMITE_INVALIDO')).toBe(
      'Informe quantas repetições disparam o alerta (número inteiro, 2 ou mais).',
    )
  })
})
