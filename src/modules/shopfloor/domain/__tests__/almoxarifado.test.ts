import { describe, it, expect } from 'vitest'
import { classificarBipeAlmoxarifado } from '../almoxarifado'

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
