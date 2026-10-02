import { describe, expect, it } from 'vitest'
import { conferirPasso, type ItemDoSetup } from '../conferencia-troca'

const itens: ItemDoSetup[] = [
  { posicao: 'P1', feeder: 'F1', componente: 'CAPJ41', rolo: 'CAPJ41-0001' },
  { posicao: 'P2', feeder: 'F2', componente: 'RESX10', rolo: 'RESX10-0007' },
  { posicao: 'P3', feeder: 'F3', componente: 'CAPJ41', rolo: null },
  { posicao: 'P4', feeder: 'F4', componente: 'CAPJ41', rolo: 'CAPJ41-0002' },
]
const smd = { itens, pth: false }
const pth = { itens, pth: true }

describe('passo da POSIÇÃO', () => {
  it('passa quando a posição existe no setup', () => {
    expect(conferirPasso({ ...smd, campo: 'posicao', valor: 'P1', bipados: {} })).toBeNull()
  })
  it('recusa a posição que não existe, com a frase do servidor', () => {
    expect(conferirPasso({ ...smd, campo: 'posicao', valor: 'P9', bipados: {} }))
      .toBe('A posição P9 não existe nesse setup.')
  })
  it('no PTH a mesma recusa fala em posto', () => {
    expect(conferirPasso({ ...pth, campo: 'posicao', valor: 'P9', bipados: {} }))
      .toBe('O posto P9 não existe nesse setup.')
  })
  it('normaliza igual ao banco: minúsculas e espaços não mudam o resultado', () => {
    expect(conferirPasso({ ...smd, campo: 'posicao', valor: ' p1 ', bipados: {} })).toBeNull()
  })
})

describe('passo do FEEDER', () => {
  it('passa quando o feeder está naquela posição', () => {
    expect(conferirPasso({ ...smd, campo: 'feeder', valor: 'F1', bipados: { posicao: 'P1' } })).toBeNull()
  })
  it('recusa o feeder que não existe no setup', () => {
    expect(conferirPasso({ ...smd, campo: 'feeder', valor: 'F9', bipados: { posicao: 'P1' } }))
      .toBe('O feeder F9 não existe nesse setup.')
  })
  it('recusa o feeder que existe, mas em outra posição', () => {
    expect(conferirPasso({ ...smd, campo: 'feeder', valor: 'F2', bipados: { posicao: 'P1' } }))
      .toBe('O feeder F2 não está na posição P1.')
  })
  it('no PTH fala em locação e posto', () => {
    expect(conferirPasso({ ...pth, campo: 'feeder', valor: 'F2', bipados: { posicao: 'P1' } }))
      .toBe('A locação F2 não está no posto P1.')
  })
})

describe('passo do ROLO QUE SAI', () => {
  it('passa quando é o rolo montado — pela chave, não pelo texto', () => {
    // CAPJ41-1 e CAPJ41-0001 são o MESMO rolo: a chave despreza os zeros à esquerda.
    expect(conferirPasso({ ...smd, campo: 'saida', valor: 'CAPJ41-1',
      bipados: { posicao: 'P1', feeder: 'F1' } })).toBeNull()
  })
  it('recusa quando o rolo montado é outro, dizendo qual é', () => {
    expect(conferirPasso({ ...smd, campo: 'saida', valor: 'RESX10-0007',
      bipados: { posicao: 'P1', feeder: 'F1' } }))
      .toBe('O rolo montado na posição P1 é CAPJ41-0001, não RESX10-0007.')
  })
  it('posição sem rolo montado diz "(nenhum)", como o servidor', () => {
    expect(conferirPasso({ ...smd, campo: 'saida', valor: 'CAPJ41-0002',
      bipados: { posicao: 'P3', feeder: 'F3' } }))
      .toBe('O rolo montado na posição P3 é (nenhum), não CAPJ41-0002.')
  })
})

describe('passo do ROLO QUE ENTRA', () => {
  const b = { posicao: 'P1', feeder: 'F1', saida: 'CAPJ41-0001' }
  it('passa com outro rolo do mesmo componente', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'CAPJ41-0099', bipados: b })).toBeNull()
  })
  it('recusa componente diferente', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'RESX10-0050', bipados: b }))
      .toBe('Componente diferente: sai CAPJ41, entra RESX10.')
  })
  it('recusa o mesmo rolo que sai', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'CAPJ41-1', bipados: b }))
      .toBe('O rolo que entra é o mesmo que sai.')
  })
  it('recusa rolo que já está montado em outra posição', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'RESX10-0007',
      bipados: { posicao: 'P2', feeder: 'F2', saida: 'RESX10-0007' } }))
      .toBe('O rolo que entra é o mesmo que sai.')
    // e o caso de verdade: entra na P1 um rolo que está montado na P2
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'RESX10-0007', bipados: b }))
      .toBe('Componente diferente: sai CAPJ41, entra RESX10.')
  })
  it('recusa o rolo que já está montado em outra posição (SMD)', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'CAPJ41-2', bipados: b }))
      .toBe('O rolo CAPJ41-2 já está montado na posição P4.')
  })
  it('recusa o rolo que já está montado em outro posto (PTH)', () => {
    expect(conferirPasso({ ...pth, campo: 'entrada', valor: 'capj41-02', bipados: b }))
      .toBe('O rolo CAPJ41-02 já está montado no posto P4.')
  })
  it('sem o rolo que sai bipado, o passo ainda não pode ser conferido', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'CAPJ41-0099',
      bipados: { posicao: 'P1', feeder: 'F1' } })).toBeNull()
  })
  it('recusa código de rolo inválido', () => {
    expect(conferirPasso({ ...smd, campo: 'entrada', valor: 'SEMTRACO', bipados: b }))
      .toBe('Código do rolo que entra inválido: SEMTRACO.')
  })
})

describe('valor vazio: nada bipado, nada a conferir', () => {
  it('o rolo que sai vazio devolve null, não uma frase com valor em branco', () => {
    expect(conferirPasso({ ...smd, campo: 'saida', valor: '',
      bipados: { posicao: 'P1', feeder: 'F1' } })).toBeNull()
  })
})

describe('o colaborador e o SN não são conferidos aqui', () => {
  it('o colaborador passa sempre', () => {
    expect(conferirPasso({ ...smd, campo: 'colaborador', valor: 'qualquer', bipados: {} })).toBeNull()
  })
  // O SN exige a faixa da OP, que o modal não carrega — fica com o servidor, no envio.
  it('o SN passa sempre', () => {
    expect(conferirPasso({ ...smd, campo: 'sn', valor: '9999', bipados: {} })).toBeNull()
  })
})
