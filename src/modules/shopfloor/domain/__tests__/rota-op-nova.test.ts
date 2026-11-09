import { describe, expect, it } from 'vitest'
import { PERFIL_PADRAO, type PerfilPosto } from '../perfil-posto'
import { MSG_ALMOXARIFADO_OBRIGATORIO, adicionarPostoNaRota, moverPostoNaRota, postoAlmoxarifadoPadrao, rotaDaEdicao, rotaPadraoOpNova } from '../rota-op-nova'

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

  it('rota do formulário sem o Almoxarifado (o servidor garante): ele entra no fim', () => {
    expect(rotaPadraoOpNova(['Teste'], 'Almoxarifado')).toEqual(['Teste', 'Almoxarifado'])
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

  it('sem o Almoxarifado no fim (OP antiga), o posto novo vai para o fim', () => {
    expect(adicionarPostoNaRota(['Teste'], 'Embalagem', 'Almoxarifado')).toEqual(['Teste', 'Embalagem'])
    expect(adicionarPostoNaRota(['Almoxarifado', 'Teste'], 'Embalagem', 'Almoxarifado')).toEqual(['Almoxarifado', 'Teste', 'Embalagem'])
  })

  it('acrescentar o próprio Almoxarifado numa rota sem ele: vai para o fim', () => {
    expect(adicionarPostoNaRota(['Teste', 'Embalagem'], 'Almoxarifado', 'Almoxarifado')).toEqual(['Teste', 'Embalagem', 'Almoxarifado'])
  })

  it('posto já presente não duplica; sem posto Almoxarifado é um append simples', () => {
    expect(adicionarPostoNaRota(['Teste', 'Almoxarifado'], 'Teste', 'Almoxarifado')).toEqual(['Teste', 'Almoxarifado'])
    expect(adicionarPostoNaRota(['Teste'], 'Embalagem', null)).toEqual(['Teste', 'Embalagem'])
  })
})

describe('moverPostoNaRota', () => {
  const ROTA = ['SMT', 'Teste', 'Almoxarifado']

  it('reordena os demais postos normalmente', () => {
    expect(moverPostoNaRota(ROTA, 1, -1, 'Almoxarifado')).toEqual(['Teste', 'SMT', 'Almoxarifado'])
    expect(moverPostoNaRota(ROTA, 0, 1, 'Almoxarifado')).toEqual(['Teste', 'SMT', 'Almoxarifado'])
  })

  it('nenhum posto desce para depois do Almoxarifado fixo', () => {
    expect(moverPostoNaRota(ROTA, 1, 1, 'Almoxarifado')).toEqual(ROTA)
  })

  it('o Almoxarifado fixo não sobe', () => {
    expect(moverPostoNaRota(ROTA, 2, -1, 'Almoxarifado')).toEqual(ROTA)
  })

  it('sem posto fixo, move livre; fora dos limites, rota intacta', () => {
    expect(moverPostoNaRota(ROTA, 2, -1, null)).toEqual(['SMT', 'Almoxarifado', 'Teste'])
    expect(moverPostoNaRota(ROTA, 0, -1, null)).toEqual(ROTA)
    expect(moverPostoNaRota(ROTA, 2, 1, null)).toEqual(ROTA)
  })
})

describe('rotaDaEdicao', () => {
  it('OP antiga sem Almoxarifado: a rota do formulário passa como veio (nada é acrescentado)', () => {
    expect(rotaDaEdicao(['Teste', 'Embalagem'], ['Embalagem', 'Teste'], 'Almoxarifado')).toEqual({ ok: true, rota: ['Embalagem', 'Teste'] })
  })

  it('OP gravada com Almoxarifado: retirar é recusado', () => {
    expect(rotaDaEdicao(['Teste', 'Almoxarifado'], ['Teste'], 'Almoxarifado')).toEqual({ ok: false, erro: MSG_ALMOXARIFADO_OBRIGATORIO })
  })

  it('OP gravada com Almoxarifado: ele é mantido como último mesmo que o formulário o mova', () => {
    expect(rotaDaEdicao(['Teste', 'Almoxarifado'], ['Almoxarifado', 'Teste', 'Embalagem'], 'Almoxarifado')).toEqual({ ok: true, rota: ['Teste', 'Embalagem', 'Almoxarifado'] })
  })

  it('a trava vem da rota GRAVADA: o formulário acrescentar o posto numa OP antiga é aceito como veio', () => {
    expect(rotaDaEdicao(['Teste'], ['Teste', 'Almoxarifado'], 'Almoxarifado')).toEqual({ ok: true, rota: ['Teste', 'Almoxarifado'] })
  })

  it('sem posto Almoxarifado no catálogo, nada muda', () => {
    expect(rotaDaEdicao(['Teste', 'Almoxarifado'], ['Teste'], null)).toEqual({ ok: true, rota: ['Teste'] })
  })
})
