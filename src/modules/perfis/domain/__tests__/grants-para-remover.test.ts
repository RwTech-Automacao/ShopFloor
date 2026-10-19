import { describe, it, expect } from 'vitest'
import { grantsParaRemover } from '../regras-perfil'

describe('grantsParaRemover', () => {
  it('não remove nada quando os grants desejados são os que já existem', () => {
    const g = [
      { modulo: 'recebimento', permissao: 'visualizar' },
      { modulo: 'sistema', permissao: 'administrar' },
    ]
    expect(grantsParaRemover(g, g)).toEqual([])
  })

  it('adicionar uma permissão (o caso do Lançar) não remove nenhuma das que já existem', () => {
    const atuais = [
      { modulo: 'recebimento', permissao: 'visualizar' },
      { modulo: 'sistema', permissao: 'administrar' },
    ]
    const desejados = [...atuais, { modulo: 'recebimento', permissao: 'lancar' }]
    expect(grantsParaRemover(atuais, desejados)).toEqual([])
  })

  it('remove só o que foi desmarcado, agrupado por módulo', () => {
    const atuais = [
      { modulo: 'recebimento', permissao: 'visualizar' },
      { modulo: 'recebimento', permissao: 'excluir' },
      { modulo: 'recebimento', permissao: 'editar' },
      { modulo: 'shopfloor', permissao: 'lancar' },
      { modulo: 'sistema', permissao: 'administrar' },
    ]
    const desejados = [
      { modulo: 'recebimento', permissao: 'visualizar' },
      { modulo: 'sistema', permissao: 'administrar' },
    ]
    expect(grantsParaRemover(atuais, desejados)).toEqual([
      ['recebimento', ['excluir', 'editar']],
      ['shopfloor', ['lancar']],
    ])
  })

  it('a mesma permissão em módulos diferentes não se confunde', () => {
    const atuais = [
      { modulo: 'recebimento', permissao: 'lancar' },
      { modulo: 'shopfloor', permissao: 'lancar' },
    ]
    expect(grantsParaRemover(atuais, [{ modulo: 'shopfloor', permissao: 'lancar' }])).toEqual([
      ['recebimento', ['lancar']],
    ])
  })

  it('desmarcar tudo remove tudo', () => {
    const atuais = [{ modulo: 'setup', permissao: 'visualizar' }]
    expect(grantsParaRemover(atuais, [])).toEqual([['setup', ['visualizar']]])
  })
})
