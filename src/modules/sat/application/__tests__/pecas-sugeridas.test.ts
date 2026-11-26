import { describe, expect, it, vi } from 'vitest'
import type { NoEstrutura } from '../../domain/estrutura'
import { pecasSugeridas, type DepsPecas } from '../pecas-sugeridas'

const n = (codigo: string, descricao: string, itemId: number | null, filhos: NoEstrutura[] = []): NoEstrutura =>
  ({ codigo, descricao, itemId, filhos })
// Produto FICTÍCIO: módulo bio (com leitor e cabo), fonte, gabinete.
const PRODUTO: NoEstrutura[] = [
  n('PMOX01', 'MODULO BIO', 11, [n('BIO001', 'LEITOR', 12), n('CB001', 'CABO', 13)]),
  n('FT100', 'FONTE', 21, [n('TR1', 'TRAFO', 22)]),
  n('GB001', 'GABINETE', 31, [n('RWSV10', 'INJECAO', 32)]),
]
const KITS: Record<string, NoEstrutura[]> = {
  PMOE74: [n('BIO001', 'LEITOR', 12), n('CB001', 'CABO', 13)],   // serve
  PMOE99: [n('BIO001', 'LEITOR', 12), n('OUTRO', 'X', 99)],      // não serve
  PMOE12: [n('FT100', 'FONTE', 21)],                             // serve (veio do histórico)
}

function deps(extra: Partial<DepsPecas> = {}): DepsPecas {
  return {
    maisUsadas: vi.fn(async () => [{ codigo: 'FT100', descricao: 'FONTE' }, { codigo: 'PRT706', descricao: 'PLACA' }]),
    kitsConhecidos: vi.fn(async () => [{ codigo: 'PMOE12', descricao: 'KIT FONTE' }, { codigo: 'PRT1', descricao: 'NÃO É KIT' }]),
    estrutura: vi.fn(async (c: string) => (c === 'PMOC31' ? PRODUTO : KITS[c] ?? null)),
    paisDoItem: vi.fn(async (id: number) => (id === 11
      ? [{ codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' }, { codigo: 'PMOE99', descricao: 'KIT X' }, { codigo: 'PMOC31', descricao: 'REL' }]
      : [])),
    ...extra,
  }
}

describe('pecasSugeridas', () => {
  it('as 3 camadas, sem repetir código (fica na primeira em que aparece)', async () => {
    const r = await pecasSugeridas(' pmoc31 ', deps())
    expect(r.maisUsadas.map((p) => p.codigo)).toEqual(['FT100', 'PRT706'])
    expect(r.kits).toEqual([{ codigo: 'PMOE12', descricao: 'KIT FONTE' }, { codigo: 'PMOE74', descricao: 'MODULO CAMABIO COM CABO' }])
    expect(r.estrutura.map((p) => p.codigo)).toEqual(['PMOX01', 'GB001'])
    expect(r.avisos).toEqual([])
  })

  it('produto sem código do Compels: só a camada 1 e um aviso', async () => {
    const d = deps()
    const r = await pecasSugeridas('REP iDClass', d)
    expect(r.kits).toEqual([])
    expect(r.estrutura).toEqual([])
    expect(r.avisos).toEqual(['O produto desta OS não é um código do Compels: as camadas de kits e de estrutura ficam vazias. Use a busca.'])
    expect(d.estrutura).not.toHaveBeenCalled()
  })

  it('produto sem estrutura no Compels: aviso', async () => {
    const r = await pecasSugeridas('PMOZ00', deps({ estrutura: vi.fn(async () => null) }))
    expect(r.avisos).toEqual(['O produto PMOZ00 não tem estrutura no Compels.'])
  })

  it('Compels fora: aviso e segue com o que tem', async () => {
    const r = await pecasSugeridas('PMOC31', deps({ estrutura: vi.fn(async () => { throw new Error('fora') }) }))
    expect(r.maisUsadas).toHaveLength(2)
    expect(r.avisos).toEqual(['Não foi possível ler a estrutura do produto no Compels agora. Use a busca.'])
  })

  it('pais falhando não derruba: os kits do histórico continuam', async () => {
    const r = await pecasSugeridas('PMOC31', deps({ paisDoItem: vi.fn(async () => { throw new Error('fora') }) }))
    expect(r.kits.map((k) => k.codigo)).toEqual(['PMOE12'])
    expect(r.avisos).toEqual(['Não foi possível procurar todos os kits no Compels agora.'])
  })

  it('mais usadas falhando: lista vazia e aviso (não some em silêncio)', async () => {
    const r = await pecasSugeridas('PMOC31', deps({ maisUsadas: vi.fn(async () => { throw new Error('fora') }) }))
    expect(r.maisUsadas).toEqual([])
    expect(r.avisos).toEqual(['Não foi possível ler as peças mais usadas neste modelo agora.'])
    expect(r.estrutura.length).toBeGreaterThan(0)
  })

  it('kits conhecidos falhando: aviso, e os pais ainda trazem kits', async () => {
    const r = await pecasSugeridas('PMOC31', deps({ kitsConhecidos: vi.fn(async () => { throw new Error('fora') }) }))
    expect(r.kits.map((k) => k.codigo)).toEqual(['PMOE74'])
    expect(r.avisos).toEqual(['Não foi possível procurar todos os kits no Compels agora.'])
  })

  it('estrutura de um kit falhando ao julgar: aviso (uma vez só), os outros kits seguem', async () => {
    const r = await pecasSugeridas('PMOC31', deps({
      estrutura: vi.fn(async (c: string) => {
        if (c === 'PMOE74') throw new Error('fora')
        return c === 'PMOC31' ? PRODUTO : KITS[c] ?? null
      }),
    }))
    expect(r.kits.map((k) => k.codigo)).toEqual(['PMOE12'])
    expect(r.avisos).toEqual(['Não foi possível procurar todos os kits no Compels agora.'])
  })
})
