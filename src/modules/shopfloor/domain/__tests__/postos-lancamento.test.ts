import { describe, expect, it } from 'vitest'
import { PERFIL_PADRAO, type PerfilPosto } from '../perfil-posto'
import { postosSelecionaveis } from '../postos-lancamento'

const perfis: Record<string, PerfilPosto> = {
  Almoxarifado: { ...PERFIL_PADRAO, recurso: 'almoxarifado' },
  Embalagem: { ...PERFIL_PADRAO, recurso: 'caixa' },
}
const perfilDo = (p: string): PerfilPosto => perfis[p] ?? PERFIL_PADRAO
const ROTA = ['Teste', 'Embalagem', 'Almoxarifado']

describe('postosSelecionaveis', () => {
  it('no Lançamento comum o posto de perfil almoxarifado NÃO é oferecido', () => {
    expect(postosSelecionaveis(ROTA, perfilDo)).toEqual(['Teste', 'Embalagem'])
  })

  it('o que não é Almoxarifado continua igual, na mesma ordem', () => {
    expect(postosSelecionaveis(['B', 'A', 'C'], perfilDo)).toEqual(['B', 'A', 'C'])
  })

  it('no modo Almoxarifado só o posto fixo aparece', () => {
    expect(postosSelecionaveis(ROTA, perfilDo, { posto: 'Almoxarifado' })).toEqual(['Almoxarifado'])
  })

  it('no modo Almoxarifado, OP sem o posto na rota não oferece nada', () => {
    expect(postosSelecionaveis(['Teste', 'Embalagem'], perfilDo, { posto: 'Almoxarifado' })).toEqual([])
  })
})
