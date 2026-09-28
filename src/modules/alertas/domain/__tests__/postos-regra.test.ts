import { describe, it, expect } from 'vitest'
import type { PerfilPosto } from '@/modules/shopfloor/domain/perfil-posto'
import {
  postoRegraDe,
  postoServeAoTipo,
  postosOferecidos,
  type PostoRegra,
} from '../postos-regra'
import { TIPOS_REGRA } from '../tipos'

function perfil(p: Partial<PerfilPosto>): PerfilPosto {
  return {
    chave: 'x', nome: 'X', temStatus: false, reprova: 'nenhum', gate: 'registrado',
    exigeManutencao: false, recurso: 'nenhum', ...p,
  }
}

const TESTE: PostoRegra = { chave: 'Teste', temStatus: true, coletaDefeito: true }
const NQA: PostoRegra = { chave: 'Inspeção NQA', temStatus: true, coletaDefeito: false }
const EMBALAGEM: PostoRegra = { chave: 'Embalagem', temStatus: false, coletaDefeito: false }
/** Ordem do fluxo, como `listarPostos` devolve. */
const FLUXO = [EMBALAGEM, TESTE, NQA]

describe('postoRegraDe', () => {
  it('lê o perfil: status e coleta de código de defeito', () => {
    expect(postoRegraDe('Teste', perfil({ temStatus: true, reprova: 'defeitos' }))).toEqual(TESTE)
    expect(postoRegraDe('Inspeção SPI', perfil({ temStatus: true, reprova: 'posicoes' }))).toEqual({
      chave: 'Inspeção SPI', temStatus: true, coletaDefeito: true,
    })
    expect(postoRegraDe('Inspeção NQA', perfil({ temStatus: true, reprova: 'nenhum' }))).toEqual(NQA)
    expect(postoRegraDe('Embalagem', perfil({ recurso: 'caixa' }))).toEqual(EMBALAGEM)
  })
})

describe('postoServeAoTipo', () => {
  it('taxa de aprovação: só quem dá Aprovado/Reprovado', () => {
    expect(postoServeAoTipo('aprovacao', TESTE)).toBe(true)
    // A NQA reprova — só não guarda código. Entra.
    expect(postoServeAoTipo('aprovacao', NQA)).toBe(true)
    // Posto de passagem: taxa sempre 100%, a regra nunca dispararia.
    expect(postoServeAoTipo('aprovacao', EMBALAGEM)).toBe(false)
  })

  it('defeito repetido: só quem registra o código do defeito', () => {
    expect(postoServeAoTipo('defeito', TESTE)).toBe(true)
    expect(postoServeAoTipo('defeito', NQA)).toBe(false)
    expect(postoServeAoTipo('defeito', EMBALAGEM)).toBe(false)
  })

  it('tempo médio por peça: qualquer posto tem intervalo entre bipes', () => {
    for (const p of FLUXO) expect(postoServeAoTipo('tempo', p)).toBe(true)
  })

  it('todo tipo aceita pelo menos o posto de teste', () => {
    for (const tipo of TIPOS_REGRA) expect(postoServeAoTipo(tipo, TESTE)).toBe(true)
  })
})

describe('postosOferecidos', () => {
  it('mantém a ordem do fluxo e esconde quem não serve ao tipo', () => {
    expect(postosOferecidos('aprovacao', FLUXO, [])).toEqual([
      { chave: 'Teste', foraDoTipo: false },
      { chave: 'Inspeção NQA', foraDoTipo: false },
    ])
    expect(postosOferecidos('defeito', FLUXO, [])).toEqual([{ chave: 'Teste', foraDoTipo: false }])
    expect(postosOferecidos('tempo', FLUXO, [])).toEqual([
      { chave: 'Embalagem', foraDoTipo: false },
      { chave: 'Teste', foraDoTipo: false },
      { chave: 'Inspeção NQA', foraDoTipo: false },
    ])
  })

  it('posto que a regra salva já tinha continua na lista, marcado como fora do tipo', () => {
    expect(postosOferecidos('aprovacao', FLUXO, ['Embalagem'])).toEqual([
      { chave: 'Embalagem', foraDoTipo: true },
      { chave: 'Teste', foraDoTipo: false },
      { chave: 'Inspeção NQA', foraDoTipo: false },
    ])
    // Na regra de defeito a NQA também é resgatada, e não vira duplicata.
    expect(postosOferecidos('defeito', FLUXO, ['Inspeção NQA'])).toEqual([
      { chave: 'Teste', foraDoTipo: false },
      { chave: 'Inspeção NQA', foraDoTipo: true },
    ])
  })

  it('posto da regra que serve ao tipo não ganha aviso; posto que não existe mais não aparece', () => {
    expect(postosOferecidos('aprovacao', FLUXO, ['Teste', 'Posto Apagado'])).toEqual([
      { chave: 'Teste', foraDoTipo: false },
      { chave: 'Inspeção NQA', foraDoTipo: false },
    ])
  })

  it('sem posto cadastrado, lista vazia', () => {
    expect(postosOferecidos('aprovacao', [], ['Teste'])).toEqual([])
  })
})
