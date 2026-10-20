import { describe, it, expect } from 'vitest'
import { classificarBipeAlmoxarifado, mensagemPostoAnteriorNaoConcluido } from '../almoxarifado'

describe('classificarBipeAlmoxarifado', () => {
  it('numa OP individual, o bipe é a série e vale 1 unidade', () => {
    const r = classificarBipeAlmoxarifado('00043-00462-0015718', true)
    expect(r).toEqual({
      ok: true,
      bipe: { tipo: 'serie', serie: '00043-00462-0015718', codigoCaixa: '', quantidade: 1 },
    })
  })

  it('numa OP coletiva, o bipe é a caixa e vale a quantidade do próprio código', () => {
    const r = classificarBipeAlmoxarifado('CX[3][10]12345-PMO973', false)
    expect(r).toEqual({
      ok: true,
      bipe: { tipo: 'caixa', serie: '', codigoCaixa: 'CX[3][10]12345-PMO973', quantidade: 10 },
    })
  })

  it('recusa a caixa ainda aberta: sem quantidade fechada não há o que dar entrada', () => {
    expect(classificarBipeAlmoxarifado('CX[3]', false)).toEqual({ ok: false, recusa: 'caixa_aberta' })
  })

  it('recusa peça solta em OP coletiva — a entrada é por caixa', () => {
    expect(classificarBipeAlmoxarifado('00043-00462-0015718', false))
      .toEqual({ ok: false, recusa: 'serie_em_op_coletiva' })
  })

  it('recusa código de caixa em OP individual — ali não existe caixa', () => {
    expect(classificarBipeAlmoxarifado('CX[3][10]12345-PMO973', true))
      .toEqual({ ok: false, recusa: 'caixa_em_op_individual' })
  })

  it('recusa bipe vazio ou só espaço', () => {
    expect(classificarBipeAlmoxarifado('   ', true)).toEqual({ ok: false, recusa: 'vazio' })
  })

  it('a caixa reprovada no NQA é reconhecida como caixa — quem recusa é o banco, com o motivo', () => {
    const r = classificarBipeAlmoxarifado('CX[7]R[14]8498-PMOC14', false)
    expect(r.ok).toBe(true)
  })
})

describe('mensagemPostoAnteriorNaoConcluido', () => {
  it('peça com posto anterior que exige aprovação: diz o posto e que precisa estar aprovada', () => {
    const m = mensagemPostoAnteriorNaoConcluido({ tipo: 'serie', postoAnterior: 'Inspeção Final', precisaAprovado: true })
    expect(m).toBe('Esta peça ainda não foi aprovada no posto anterior (Inspeção Final). Aprove a peça lá antes de dar entrada.')
  })

  it('peça com posto anterior sem status: diz o posto e que precisa passar por ele', () => {
    const m = mensagemPostoAnteriorNaoConcluido({ tipo: 'serie', postoAnterior: 'Embalagem', precisaAprovado: false })
    expect(m).toBe('Esta peça ainda não passou pelo posto anterior (Embalagem). Registre a peça lá antes de dar entrada.')
    expect(m).not.toMatch(/aprovad/i)
  })

  it('caixa com posto anterior que exige aprovação: todas as peças aprovadas', () => {
    const m = mensagemPostoAnteriorNaoConcluido({ tipo: 'caixa', postoAnterior: 'Inspeção NQA', precisaAprovado: true })
    expect(m).toBe('Esta caixa ainda não foi concluída no posto anterior (Inspeção NQA): todas as peças precisam estar aprovadas lá.')
  })

  it('caixa com posto anterior sem status: todas as peças registradas', () => {
    const m = mensagemPostoAnteriorNaoConcluido({ tipo: 'caixa', postoAnterior: 'Inspeção Final', precisaAprovado: false })
    expect(m).toBe('Esta caixa ainda não foi concluída no posto anterior (Inspeção Final): todas as peças precisam estar registradas lá.')
  })

  it('caixa com a contagem: diz quantas peças faltam de quantas', () => {
    const m = mensagemPostoAnteriorNaoConcluido({
      tipo: 'caixa', postoAnterior: 'Inspeção NQA', precisaAprovado: true, faltam: 4, pecas: 25,
    })
    expect(m).toBe('Esta caixa ainda não foi concluída no posto anterior (Inspeção NQA): 4 de 25 peças ainda sem aprovação lá.')
  })

  it('caixa de uma peça só, sem status: singular e "registro"', () => {
    const m = mensagemPostoAnteriorNaoConcluido({
      tipo: 'caixa', postoAnterior: 'Inspeção Final', precisaAprovado: false, faltam: 1, pecas: 1,
    })
    expect(m).toBe('Esta caixa ainda não foi concluída no posto anterior (Inspeção Final): 1 de 1 peça ainda sem registro lá.')
  })

  it('caixa com contagem inconsistente (faltam 0 ou caixa sem peças): volta à frase geral', () => {
    const geral = 'Esta caixa ainda não foi concluída no posto anterior (Inspeção NQA): todas as peças precisam estar aprovadas lá.'
    expect(mensagemPostoAnteriorNaoConcluido({ tipo: 'caixa', postoAnterior: 'Inspeção NQA', precisaAprovado: true, faltam: 0, pecas: 25 })).toBe(geral)
    expect(mensagemPostoAnteriorNaoConcluido({ tipo: 'caixa', postoAnterior: 'Inspeção NQA', precisaAprovado: true, faltam: 3, pecas: 0 })).toBe(geral)
  })
})
