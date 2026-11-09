import { describe, expect, it } from 'vitest'
import { PERFIL_PADRAO, type PerfilPosto } from '../perfil-posto'
import { adicionarPostoNaRota, postoAlmoxarifadoPadrao, rotaPadraoOpNova } from '../rota-op-nova'

const perfis: Record<string, PerfilPosto> = {
  Almoxarifado: { ...PERFIL_PADRAO, recurso: 'almoxarifado' },
  Embalagem: { ...PERFIL_PADRAO, recurso: 'caixa' },
}
const perfilDo = (p: string): PerfilPosto => perfis[p] ?? PERFIL_PADRAO

describe('postoAlmoxarifadoPadrao', () => {
  it('acha o posto pelo PERFIL (recurso almoxarifado), não pelo nome', () => {
    expect(postoAlmoxarifadoPadrao(['Teste', 'Embalagem', 'Almoxarifado'], perfilDo)).toBe('Almoxarifado')
    const renomeado = (p: string) => (p === 'Estoque PA' ? { recurso: 'almoxarifado' as const } : { recurso: 'nenhum' as const })
    expect(postoAlmoxarifadoPadrao(['Teste', 'Almoxarifado', 'Estoque PA'], renomeado)).toBe('Estoque PA')
  })

  it('sem posto de perfil almoxarifado = null (sem erro)', () => {
    expect(postoAlmoxarifadoPadrao(['Teste', 'Embalagem'], perfilDo)).toBeNull()
    expect(postoAlmoxarifadoPadrao([], perfilDo)).toBeNull()
  })

  it('mais de um: o primeiro na ordem do catálogo desempata', () => {
    const dois = (p: string) => ({ recurso: p.startsWith('Almox') ? ('almoxarifado' as const) : ('nenhum' as const) })
    expect(postoAlmoxarifadoPadrao(['Teste', 'Almox B', 'Almox A'], dois)).toBe('Almox B')
  })
})

describe('rotaPadraoOpNova', () => {
  it('OP nova do zero: a rota já nasce com o Almoxarifado', () => {
    expect(rotaPadraoOpNova([], 'Almoxarifado')).toEqual(['Almoxarifado'])
  })

  it('Padrão sem Almoxarifado: ele entra no fim', () => {
    expect(rotaPadraoOpNova(['SMT', 'Teste', 'Embalagem'], 'Almoxarifado')).toEqual(['SMT', 'Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('Padrão que já termina no Almoxarifado: não duplica', () => {
    expect(rotaPadraoOpNova(['Teste', 'Embalagem', 'Almoxarifado'], 'Almoxarifado')).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('Padrão com o Almoxarifado no meio: ele vai para o fim, uma vez só', () => {
    expect(rotaPadraoOpNova(['Teste', 'Almoxarifado', 'Embalagem', 'Almoxarifado'], 'Almoxarifado')).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('sem posto Almoxarifado: devolve a base intacta (só sem repetições)', () => {
    expect(rotaPadraoOpNova(['Teste', 'Embalagem', 'Teste'], null)).toEqual(['Teste', 'Embalagem'])
    expect(rotaPadraoOpNova([], null)).toEqual([])
  })

  it('não altera a base recebida', () => {
    const base = ['Teste']
    rotaPadraoOpNova(base, 'Almoxarifado')
    expect(base).toEqual(['Teste'])
  })
})

describe('adicionarPostoNaRota', () => {
  it('com o Almoxarifado no fim, o posto novo entra antes dele', () => {
    expect(adicionarPostoNaRota(['Teste', 'Almoxarifado'], 'Embalagem', 'Almoxarifado')).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
    expect(adicionarPostoNaRota(['Almoxarifado'], 'Teste', 'Almoxarifado')).toEqual(['Teste', 'Almoxarifado'])
  })

  it('sem o Almoxarifado no fim (tirado ou movido), o posto novo vai para o fim', () => {
    expect(adicionarPostoNaRota(['Teste'], 'Embalagem', 'Almoxarifado')).toEqual(['Teste', 'Embalagem'])
    expect(adicionarPostoNaRota(['Almoxarifado', 'Teste'], 'Embalagem', 'Almoxarifado')).toEqual(['Almoxarifado', 'Teste', 'Embalagem'])
  })

  it('devolver o Almoxarifado que foi tirado: ele volta para o fim', () => {
    expect(adicionarPostoNaRota(['Teste', 'Embalagem'], 'Almoxarifado', 'Almoxarifado')).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('posto já presente não duplica; sem posto Almoxarifado é um append simples', () => {
    expect(adicionarPostoNaRota(['Teste', 'Almoxarifado'], 'Teste', 'Almoxarifado')).toEqual(['Teste', 'Almoxarifado'])
    expect(adicionarPostoNaRota(['Teste'], 'Embalagem', null)).toEqual(['Teste', 'Embalagem'])
  })
})
