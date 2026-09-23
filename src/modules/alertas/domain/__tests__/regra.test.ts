import { describe, it, expect } from 'vitest'
import { validarRegra, validarPrevia, destinatariosSemCanal, PADROES_REGRA, type EntradaRegra } from '../regra'

const BASE: EntradaRegra = {
  nome: '  Teste   abaixo de 90 ',
  postos: ['Teste', 'Teste', ' '],
  taxaMinima: '92,5',
  janelaTipo: 'tempo',
  janelaValor: '60',
  minimoBipes: '20',
  lembreteMin: '',
  canais: ['telegram', 'telegram'],
  destinatarios: ['u1', 'u1', 'u2'],
  ativa: true,
}

describe('validarRegra', () => {
  it('normaliza nome, postos, canais e destinatários e aceita vírgula na taxa', () => {
    const r = validarRegra(BASE)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.valor).toEqual({
      tipo: 'aprovacao',
      nome: 'Teste abaixo de 90',
      postos: ['Teste'],
      taxaMinima: 92.5,
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: 20,
      limiteTempoSeg: null,
      limiteOcorrencias: null,
      pausaMaxMin: null,
      lembreteMin: null,
      canais: ['telegram'],
      destinatarios: ['u1', 'u2'],
      avisarPessoas: true,
      avisarCanal: false,
      pmos: [],
      ativa: true,
    })
  })

  it('janela op não tem valor', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'op', janelaValor: '60' })
    expect(r.ok && r.valor.janelaValor).toBeNull()
  })

  it('lembrete em minutos', () => {
    const r = validarRegra({ ...BASE, lembreteMin: '15' })
    expect(r.ok && r.valor.lembreteMin).toBe(15)
  })

  it('exige nome', () => {
    expect(validarRegra({ ...BASE, nome: '   ' })).toEqual({ ok: false, erro: 'Informe o nome da regra.' })
  })

  it('exige pelo menos 1 posto, 1 canal e 1 responsável', () => {
    expect(validarRegra({ ...BASE, postos: [] })).toEqual({ ok: false, erro: 'Escolha pelo menos 1 posto.' })
    expect(validarRegra({ ...BASE, canais: [] })).toEqual({ ok: false, erro: 'Escolha pelo menos 1 canal.' })
    expect(validarRegra({ ...BASE, destinatarios: [] })).toEqual({
      ok: false,
      erro: 'Escolha pelo menos 1 responsável.',
    })
  })

  it('recusa canal desconhecido', () => {
    expect(validarRegra({ ...BASE, canais: ['whatsapp'] })).toEqual({ ok: false, erro: 'Escolha pelo menos 1 canal.' })
  })

  it('taxa mínima entre 0 e 100, com até 2 casas', () => {
    expect(validarRegra({ ...BASE, taxaMinima: '101' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
    expect(validarRegra({ ...BASE, taxaMinima: '' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
    expect(validarRegra({ ...BASE, taxaMinima: '90,125' })).toEqual({
      ok: false,
      erro: 'A taxa mínima aceita até 2 casas decimais.',
    })
  })

  it('janela e mínimo precisam ser inteiros positivos', () => {
    expect(validarRegra({ ...BASE, janelaValor: '0' })).toEqual({
      ok: false,
      erro: 'Informe quantos minutos a janela olha.',
    })
    expect(validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '1,5' })).toEqual({
      ok: false,
      erro: 'Informe quantos bipes a janela olha.',
    })
    expect(validarRegra({ ...BASE, minimoBipes: '0' })).toEqual({
      ok: false,
      erro: 'O mínimo de bipes deve ser um número inteiro maior que zero.',
    })
    expect(validarRegra({ ...BASE, lembreteMin: '-3' })).toEqual({
      ok: false,
      erro: 'O lembrete deve ser um número inteiro de minutos (ou vazio).',
    })
  })

  it('janela de bipes menor que o mínimo nunca avaliaria', () => {
    expect(validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '10', minimoBipes: '20' })).toEqual({
      ok: false,
      erro: 'A janela de bipes precisa ser maior ou igual ao mínimo de bipes.',
    })
  })

  it('janela de tempo tem teto de 7 dias (10080 min); a de bipes não', () => {
    expect(validarRegra({ ...BASE, janelaValor: '10081' })).toEqual({
      ok: false,
      erro: 'A janela de tempo pode ter no máximo 7 dias (10080 minutos).',
    })
    const r = validarRegra({ ...BASE, janelaValor: '10080' })
    expect(r.ok && r.valor.janelaValor).toBe(10080)
    const b = validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '20000' })
    expect(b.ok && b.valor.janelaValor).toBe(20000)
  })

  it('janela de bipes igual ao mínimo é aceita', () => {
    const r = validarRegra({ ...BASE, janelaTipo: 'bipes', janelaValor: '20', minimoBipes: '20' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.valor.janelaValor).toBe(20)
  })

  it('fronteiras da taxa: 0 e 100 são aceitos', () => {
    expect(validarRegra({ ...BASE, taxaMinima: '0' }).ok).toBe(true)
    expect(validarRegra({ ...BASE, taxaMinima: '100' }).ok).toBe(true)
  })

  it('fronteiras da taxa: acima de 100 é recusado, com vírgula ou ponto', () => {
    expect(validarRegra({ ...BASE, taxaMinima: '100.001' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
    expect(validarRegra({ ...BASE, taxaMinima: '100,01' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
  })

  it('fronteiras da taxa: valor negativo é recusado', () => {
    expect(validarRegra({ ...BASE, taxaMinima: '-1' })).toEqual({
      ok: false,
      erro: 'A taxa mínima deve ficar entre 0 e 100.',
    })
  })

  it('payload malformado: campo que não é array vira lista vazia (recusado pela regra)', () => {
    expect(
      validarRegra({ ...BASE, postos: 'Teste' as unknown as string[] }),
    ).toEqual({ ok: false, erro: 'Escolha pelo menos 1 posto.' })
    expect(
      validarRegra({ ...BASE, canais: null as unknown as string[] }),
    ).toEqual({ ok: false, erro: 'Escolha pelo menos 1 canal.' })
    expect(
      validarRegra({ ...BASE, destinatarios: undefined as unknown as string[] }),
    ).toEqual({ ok: false, erro: 'Escolha pelo menos 1 responsável.' })
  })

  it('recusa janela desconhecida', () => {
    expect(validarRegra({ ...BASE, janelaTipo: 'lua' })).toEqual({ ok: false, erro: 'Escolha a janela da regra.' })
  })

  it('os padrões da spec', () => {
    expect(PADROES_REGRA).toEqual({ taxaMinima: 90, janelaTempo: 60, janelaBipes: 50, minimoBipes: 20 })
  })
})

describe('validarPrevia', () => {
  it('aceita só o que a prévia precisa', () => {
    const r = validarPrevia({ postos: ['Teste'], janelaTipo: 'op', janelaValor: null, minimoBipes: '20' })
    expect(r).toEqual({
      ok: true,
      valor: {
        tipo: 'aprovacao',
        postos: ['Teste'],
        janelaTipo: 'op',
        janelaValor: null,
        minimoBipes: 20,
        pausaMaxMin: null,
        limiteOcorrencias: null,
        pmos: [],
      },
    })
  })
  it('sem posto não há prévia', () => {
    expect(validarPrevia({ postos: [], janelaTipo: 'tempo', janelaValor: 60, minimoBipes: 20 })).toEqual({
      ok: false,
      erro: 'Escolha pelo menos 1 posto.',
    })
  })
})

describe('destinatariosSemCanal', () => {
  const disponiveis = [
    { usuarioId: 'u1', nome: 'Ana Gestora', email: 'ana@x', telegram: true, discord: true },
    { usuarioId: 'u2', nome: 'Bruno Líder', email: 'bruno@x', telegram: true, discord: false },
    { usuarioId: 'u3', nome: 'Carla Operadora', email: 'carla@x', telegram: false, discord: false },
  ]
  it('lista quem não recebe pelos canais escolhidos', () => {
    expect(destinatariosSemCanal(disponiveis, ['u1', 'u2', 'u3'], ['telegram', 'discord'])).toEqual([
      'Bruno Líder sem Discord',
      'Carla Operadora sem Telegram',
      'Carla Operadora sem Discord',
    ])
  })
  it('ninguém faltando, lista vazia', () => {
    expect(destinatariosSemCanal(disponiveis, ['u1'], ['telegram', 'discord'])).toEqual([])
  })
})
