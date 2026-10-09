import { describe, expect, it } from 'vitest'
import { validarRegra, type EntradaRegra } from '../regra'
import { HORA_RESUMO_MAX, HORA_RESUMO_MIN } from '../resumo'
import { DESCRICAO_TIPO_REGRA, NOME_TIPO_REGRA, TIPOS_REGRA, ehTipoRegra } from '../tipos'

const BASE: EntradaRegra = {
  tipo: 'resumo',
  nome: 'Resumo do dia',
  postos: ['Inspeção PTH'],
  taxaMinima: '',
  janelaTipo: 'intervalos',
  janelaValor: null,
  minimoBipes: '',
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  intervalos: [{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }],
  horaResumo: '18:00',
  ativa: true,
}

const MSG_CAMPO = 'O resumo diário não usa este campo.'
const MSG_HORA =
  'A hora do resumo deve ficar entre 06:00 e 19:00 (fora disso o banco está desligado e o relatório não sairia).'

function erroDe(e: EntradaRegra): string | null {
  const r = validarRegra(e)
  return r.ok ? null : r.erro
}

describe('tipo resumo declarado', () => {
  it('está nos tipos, com nome e descrição', () => {
    expect(ehTipoRegra('resumo')).toBe(true)
    expect(TIPOS_REGRA).toContain('resumo')
    expect(NOME_TIPO_REGRA.resumo).toBe('Resumo diário')
    expect(DESCRICAO_TIPO_REGRA.resumo).toBe('Manda, na hora escolhida, a taxa de aprovação do dia de cada posto.')
  })
})

describe('validarRegra: resumo válido', () => {
  it('sai com janela intervalos, sem passo, e só os campos dele', () => {
    const r = validarRegra(BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.tipo).toBe('resumo')
    expect(r.valor.janelaTipo).toBe('intervalos')
    expect(r.valor.janelaValor).toBeNull()
    expect(r.valor.horaResumo).toBe('18:00')
    expect(r.valor.intervalos).toEqual([
      { inicio: '07:00', fim: '12:00' },
      { inicio: '13:30', fim: '17:30' },
    ])
    expect(r.valor.taxaMinima).toBeNull()
    expect(r.valor.minimoBipes).toBeNull()
    expect(r.valor.limiteTempoSeg).toBeNull()
    expect(r.valor.limiteOcorrencias).toBeNull()
    expect(r.valor.pausaMaxMin).toBeNull()
    expect(r.valor.lembreteMin).toBeNull()
  })

  it('ignora o tipo de janela que o formulário mandar: sai sempre intervalos', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'tempo' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.janelaTipo).toBe('intervalos')
    expect(r.valor.janelaValor).toBeNull()
  })

  it('outros tipos saem com horaResumo null', () => {
    const r = validarRegra({
      ...BASE, tipo: 'aprovacao', taxaMinima: '90', minimoBipes: '20', janelaTipo: 'tempo', janelaValor: '60',
      horaResumo: '18:00',
    })
    expect(r.ok && r.valor.horaResumo).toBeNull()
  })
})

describe('validarRegra: hora do resumo, fronteiras exatas', () => {
  it('as constantes são as fronteiras 06:00 e 19:00', () => {
    expect(HORA_RESUMO_MIN).toBe('06:00')
    expect(HORA_RESUMO_MAX).toBe('19:00')
  })
  it('06:00 é aceita', () => {
    // Turno que fecha antes das 06:00, para isolar o piso da regra do fim do turno.
    const r = validarRegra({ ...BASE, intervalos: [{ inicio: '04:00', fim: '05:00' }], horaResumo: '06:00' })
    expect(r.ok && r.valor.horaResumo).toBe('06:00')
  })
  it('19:00 é aceita', () => {
    const r = validarRegra({ ...BASE, horaResumo: '19:00' })
    expect(r.ok && r.valor.horaResumo).toBe('19:00')
  })
  it('05:59 é recusada', () => {
    expect(erroDe({ ...BASE, horaResumo: '05:59' })).toBe(MSG_HORA)
  })
  it('19:01 é recusada', () => {
    expect(erroDe({ ...BASE, horaResumo: '19:01' })).toBe(MSG_HORA)
  })
  it.each([undefined, null, '', '18', '6:00', '25:00', 'abc'])('hora ausente ou malformada (%s) é recusada', (h) => {
    expect(erroDe({ ...BASE, horaResumo: h })).toBe('Informe a hora do resumo no formato HH:MM (ex.: 18:00).')
  })
})

describe('validarRegra: resumo recusa, campo a campo, o que não usa', () => {
  const casos: [string, Partial<EntradaRegra>][] = [
    ['taxaMinima', { taxaMinima: '90' }],
    ['minimoBipes', { minimoBipes: '20' }],
    ['lembreteMin', { lembreteMin: '30' }],
    ['limiteTempo', { limiteTempo: '2:00' }],
    ['limiteOcorrencias', { limiteOcorrencias: '5' }],
    ['pausaMaxMin', { pausaMaxMin: '30' }],
  ]
  it.each(casos)('recusa %s preenchido', (_campo, extra) => {
    expect(erroDe({ ...BASE, ...extra })).toBe(MSG_CAMPO)
  })
  it('aceita o valor 0 como preenchido? recusa (0 não é vazio)', () => {
    expect(erroDe({ ...BASE, taxaMinima: 0 })).toBe(MSG_CAMPO)
  })
  it('o base, com todos esses campos vazios, passa', () => {
    expect(erroDe({ ...BASE, limiteTempo: '', limiteOcorrencias: null, pausaMaxMin: null })).toBeNull()
  })
})

describe('validarRegra: resumo continua exigindo o que é dele', () => {
  it('nome', () => expect(erroDe({ ...BASE, nome: ' ' })).toBe('Informe o nome da regra.'))
  it('pelo menos 1 posto', () => expect(erroDe({ ...BASE, postos: [] })).toBe('Escolha pelo menos 1 posto.'))
  it('intervalos', () =>
    expect(erroDe({ ...BASE, intervalos: [] })).toBe('Cadastre pelo menos 1 intervalo de horário.'))
  it('destinatários', () =>
    expect(erroDe({ ...BASE, destinatarios: [] })).toBe('Escolha pelo menos 1 responsável.'))
  it('canais', () =>
    expect(erroDe({ ...BASE, canais: [] })).toBe(
      'Marque pelo menos 1 canal da conversa privada: Telegram ou Discord.',
    ))
})

const MSG_APOS_TURNO =
  'O resumo do dia tem de sair depois que o último intervalo fecha. Antes disso ele sairia com os números do começo do turno e o relatório do dia inteiro se perderia.'

describe('validarRegra: o resumo só sai depois que o último intervalo fecha', () => {
  // Fora de ordem de propósito: o último da LISTA (07:00–12:00) não é o que fecha por último.
  const FORA_DE_ORDEM = [
    { inicio: '13:30', fim: '17:30' },
    { inicio: '07:00', fim: '12:00' },
  ]

  it('hora IGUAL ao fim do último intervalo é aceita', () => {
    expect(erroDe({ ...BASE, intervalos: FORA_DE_ORDEM, horaResumo: '17:30' })).toBeNull()
  })
  it('UM minuto antes do fim do último intervalo é recusada', () => {
    expect(erroDe({ ...BASE, intervalos: FORA_DE_ORDEM, horaResumo: '17:29' })).toBe(MSG_APOS_TURNO)
  })
  it('o último é o de MAIOR fim, não o último do array (nem o primeiro)', () => {
    // Se a validação olhasse o último do array (07:00–12:00), 12:00 passaria. Não pode.
    expect(erroDe({ ...BASE, intervalos: FORA_DE_ORDEM, horaResumo: '12:00' })).toBe(MSG_APOS_TURNO)
    // E se olhasse o primeiro do array (13:30–17:30), 17:30 já passava; aqui o maior fim é 18:10.
    const tres = [...FORA_DE_ORDEM, { inicio: '17:40', fim: '18:10' }]
    expect(erroDe({ ...BASE, intervalos: tres, horaResumo: '18:09' })).toBe(MSG_APOS_TURNO)
    expect(erroDe({ ...BASE, intervalos: tres, horaResumo: '18:10' })).toBeNull()
  })
  it('o piso de 06:00 continua valendo com turno que fecha cedo', () => {
    const cedo = [{ inicio: '04:00', fim: '05:00' }]
    expect(erroDe({ ...BASE, intervalos: cedo, horaResumo: '05:30' })).toBe(MSG_HORA)
  })
  it('janelaValor preenchido é recusado, como os demais campos alheios', () => {
    expect(erroDe({ ...BASE, janelaValor: '30' })).toBe(MSG_CAMPO)
  })
})
