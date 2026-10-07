import { describe, expect, it } from 'vitest'
import { validarPrevia, validarRegra, type EntradaRegra } from '../regra'

const BASE: EntradaRegra = {
  tipo: 'aprovacao',
  nome: 'Inspeção por bloco',
  postos: ['Inspeção PTH'],
  taxaMinima: '95',
  janelaTipo: 'intervalos',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  intervalos: [{ inicio: '07:00', fim: '12:00' }, { inicio: '13:30', fim: '17:30' }],
  ativa: true,
}

describe('validarRegra com a janela intervalos', () => {
  it('aceita e devolve os intervalos ordenados', () => {
    const r = validarRegra({
      ...BASE,
      intervalos: [{ inicio: '13:30', fim: '17:30' }, { inicio: '07:00', fim: '12:00' }],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.janelaTipo).toBe('intervalos')
    expect(r.valor.janelaValor).toBe(60)
    expect(r.valor.intervalos).toEqual([
      { inicio: '07:00', fim: '12:00' },
      { inicio: '13:30', fim: '17:30' },
    ])
  })

  it('ZERA o lembrete: quem manda é o bloco', () => {
    const r = validarRegra({ ...BASE, lembreteMin: '30' })
    expect(r.ok && r.valor.lembreteMin).toBeNull()
  })

  it('ignora até um lembrete inválido nessa janela', () => {
    const r = validarRegra({ ...BASE, lembreteMin: 'abc' })
    expect(r.ok && r.valor.lembreteMin).toBeNull()
  })

  it('fora da janela intervalos o lembrete continua valendo', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'tempo', lembreteMin: '30' })
    expect(r.ok && r.valor.lembreteMin).toBe(30)
  })

  it('recusa a janela de blocos no tipo tempo', () => {
    const r = validarRegra({ ...BASE, tipo: 'tempo', limiteTempo: '2:00' })
    expect(r).toEqual({ ok: false, erro: 'Só a taxa de aprovação usa a janela por blocos de turno.' })
  })

  it('recusa a janela de blocos no tipo defeito', () => {
    const r = validarRegra({ ...BASE, tipo: 'defeito', limiteOcorrencias: '5' })
    expect(r).toEqual({ ok: false, erro: 'Só a taxa de aprovação usa a janela por blocos de turno.' })
  })

  it('recusa sem intervalo nenhum', () => {
    expect(validarRegra({ ...BASE, intervalos: [] })).toEqual({
      ok: false,
      erro: 'Cadastre pelo menos 1 intervalo de horário.',
    })
  })

  it('sobe o erro de validarIntervalos (meia-noite)', () => {
    const r = validarRegra({ ...BASE, intervalos: [{ inicio: '22:00', fim: '06:00' }] })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro).toContain('meia-noite')
  })

  it('sobe o erro do passo pequeno (10 < 15)', () => {
    const r = validarRegra({ ...BASE, janelaValor: '10' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.erro).toContain('no mínimo 15 minutos')
  })

  it('o passo é entregue a validarIntervalos: 14 recusa, 15 aceita', () => {
    expect(validarRegra({ ...BASE, janelaValor: '14' }).ok).toBe(false)
    expect(validarRegra({ ...BASE, janelaValor: '15' }).ok).toBe(true)
  })

  it('o passo maior que o menor intervalo sobe como erro da regra', () => {
    // menor intervalo = 4h (13:30–17:30); passo de 241 min não cabe
    const r = validarRegra({ ...BASE, janelaValor: '241' })
    expect(r.ok).toBe(false)
  })

  it('recusa passo vazio', () => {
    expect(validarRegra({ ...BASE, janelaValor: null })).toEqual({
      ok: false,
      erro: 'Informe o passo do bloco em minutos.',
    })
  })

  it('recusa passo decimal, zero e texto', () => {
    for (const v of ['60.5', '0', 'abc', '-30']) {
      expect(validarRegra({ ...BASE, janelaValor: v })).toEqual({
        ok: false,
        erro: 'Informe o passo do bloco em minutos.',
      })
    }
  })

  it('NÃO aplica o check de janela de bipes < mínimo de bipes', () => {
    // passo 15 min e mínimo de 20 bipes: válido aqui (são grandezas diferentes)
    expect(validarRegra({ ...BASE, janelaValor: '15', minimoBipes: '20' }).ok).toBe(true)
  })

  it('o check de bipes continua valendo na janela bipes', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '15', minimoBipes: '20' })
    expect(r).toEqual({ ok: false, erro: 'A janela de bipes precisa ser maior ou igual ao mínimo de bipes.' })
  })

  it('nas outras janelas, intervalos sai vazio e a entrada é ignorada', () => {
    for (const janelaTipo of ['tempo', 'bipes', 'op']) {
      const r = validarRegra({ ...BASE, janelaTipo, janelaValor: '60' })
      expect(r.ok && r.valor.intervalos).toEqual([])
    }
  })

  it('nas outras janelas, intervalos inválidos não atrapalham', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'tempo', intervalos: 'lixo' })
    expect(r.ok && r.valor.intervalos).toEqual([])
  })
})

describe('validarPrevia com a janela intervalos', () => {
  it('repassa os intervalos e o passo', () => {
    const r = validarPrevia({
      postos: ['Inspeção PTH'],
      janelaTipo: 'intervalos',
      janelaValor: '60',
      minimoBipes: '20',
      intervalos: BASE.intervalos,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor.intervalos).toEqual(BASE.intervalos)
    expect(r.valor.janelaValor).toBe(60)
  })

  it('sem intervalos a prévia recusa', () => {
    expect(validarPrevia({ postos: ['P'], janelaTipo: 'intervalos', janelaValor: '60', minimoBipes: '20' }).ok).toBe(false)
  })

  it('fora da janela, intervalos sai vazio', () => {
    const r = validarPrevia({ postos: ['P'], janelaTipo: 'tempo', janelaValor: '60', minimoBipes: '20' })
    expect(r.ok && r.valor.intervalos).toEqual([])
  })
})
