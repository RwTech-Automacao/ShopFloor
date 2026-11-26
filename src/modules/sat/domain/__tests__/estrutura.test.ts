import { describe, expect, it } from 'vitest'
import {
  arvoreDaResposta, codigosDaArvore, filtroBuscaItem, foraDaLista, idDaComposicao, itensDaBusca, kitServe,
  paisDaResposta, pecasTrocaveis, type NoEstrutura,
} from '../estrutura'

// Árvore FICTÍCIA no formato do findComposicaoByIdEntireTree ({children, success}; cada nó com item e children).
const no = (codigo: string, descricao: string, id: number | null, children: unknown[] = []) =>
  ({ item: { codigo, descricao, ...(id === null ? {} : { id }) }, children })
const RESPOSTA = {
  success: true,
  children: [
    no('PMOX01', 'MODULO BIOMETRICO', 11, [no('CB001', 'CABO FLAT', 12), no('BIO001', 'LEITOR BIO', 13)]),
    no('PRT900', 'PLACA PTH MONTADA', 21, [
      no('PRT901', 'PLACA SMD', 22, [no('R001', 'RESISTOR 10K', 23)]),
      no('C001', 'CAPACITOR', 24),
      no('FT100', 'FONTE 12V', 25, [no('TR1', 'TRAFO', 26)]),
    ]),
    no('GB001', 'GABINETE', 31, [no('RWSV10', 'SERVICO DE INJECAO', 32)]),
    no('RWSV11', 'SERVICO DE PINTURA', 33, [no('TINTA', 'TINTA', 34)]),
    no('EMB001', 'EMBALAGEM COMPLETA', 41, [no('CX01', 'CAIXA DE PAPELAO', 42)]),
    no('PAR01', 'PARAFUSO M3', 51),
    no('PMOE74', 'MODULO CAMABIO COM CABO', 61, [no('CB001', 'CABO FLAT', 12)]),
  ],
}

describe('idDaComposicao', () => {
  it('aceita {data: {id}}, {data: [{id}]}, {id} e lista; sem id → null', () => {
    expect(idDaComposicao({ data: { id: 77 } })).toBe(77)
    expect(idDaComposicao({ data: [{ id: 78 }] })).toBe(78)
    expect(idDaComposicao({ id: 79 })).toBe(79)
    expect(idDaComposicao([{ id: 80 }])).toBe(80)
    expect(idDaComposicao({ data: null, success: true })).toBeNull()
    expect(idDaComposicao({ data: [] })).toBeNull()
  })
})

describe('arvoreDaResposta', () => {
  it('lê os nós de 1º nível com os filhos (código em maiúsculo, item.id quando vem)', () => {
    const a = arvoreDaResposta(RESPOSTA, 'PMOC31')
    expect(a.map((n) => n.codigo)).toEqual(['PMOX01', 'PRT900', 'GB001', 'RWSV11', 'EMB001', 'PAR01', 'PMOE74'])
    expect(a[0]).toMatchObject({ descricao: 'MODULO BIOMETRICO', itemId: 11 })
    expect(a[1]!.filhos[0]!.filhos[0]!.codigo).toBe('R001')
  })
  it('se a raiz vier como um nó só (o próprio produto), desce nele', () => {
    const a = arvoreDaResposta({ success: true, children: [no('PMOC31', 'RELOGIO', 1, RESPOSTA.children)] }, 'pmoc31')
    expect(a.map((n) => n.codigo)[0]).toBe('PMOX01')
  })
  it('sem children: resposta inesperada', () => {
    expect(() => arvoreDaResposta({ success: false }, 'PMOC31')).toThrow(/estrutura do produto/)
  })
  describe('formas de children toleradas (raiz e níveis internos)', () => {
    const lista = RESPOSTA.children
    const base = arvoreDaResposta(RESPOSTA, 'PMOC31')
    const mapa = (ns: unknown[]) => Object.fromEntries(ns.map((n, i) => [String(i), n]))
    const comInternos = (f: (ns: unknown[]) => unknown) =>
      lista.map((n) => ({ ...n, children: f(n.children) }))
    const igual = (resposta: unknown) => {
      const a = arvoreDaResposta(resposta, 'PMOC31')
      expect(a).toEqual(base)
      expect(pecasTrocaveis(a).map((n) => n.codigo)).toEqual(['PMOX01', 'GB001', 'PMOE74', 'FT100'])
      expect(kitServe(a[0]!.filhos, codigosDaArvore(a))).toBe(true)
    }
    it('raiz children como um nó só (objeto)', () => {
      const a = arvoreDaResposta({ success: true, children: no('PMOX01', 'MODULO BIOMETRICO', 11, [no('CB001', 'CABO FLAT', 12)]) }, 'PMOC31')
      expect(a.map((n) => n.codigo)).toEqual(['PMOX01'])
      expect(a[0]!.filhos.map((n) => n.codigo)).toEqual(['CB001'])
    })
    it('raiz children como mapa por chave', () => igual({ success: true, children: mapa(lista) }))
    it('raiz children como { data: [...] }', () => igual({ success: true, children: { data: lista } }))
    it('raiz em data em vez de children', () => igual({ success: true, data: lista }))
    it('children internos como objeto/mapa', () => igual({ children: comInternos((ns) => mapa(ns)) }))
    it('children internos como { data: [...] }', () => igual({ children: comInternos((ns) => ({ data: ns })) }))
    it('children vazio mas presente é árvore vazia, sem erro', () => {
      expect(arvoreDaResposta({ children: {} }, 'P')).toEqual([])
      expect(arvoreDaResposta({ children: [] }, 'P')).toEqual([])
    })
  })
  it('nó sem código é ignorado', () => {
    expect(arvoreDaResposta({ children: [{ item: {} }, no('A1', 'X', null)] }, 'P')).toEqual([
      { codigo: 'A1', descricao: 'X', itemId: null, filhos: [] },
    ])
  })
})

describe('camada 3 — pecasTrocaveis', () => {
  const a = arvoreDaResposta(RESPOSTA, 'PMOC31')
  it('1º e 2º nível com filhos ou PMO*; sem PRT*, RWSV*, embalagem e folhas comuns', () => {
    expect(pecasTrocaveis(a).map((n) => n.codigo)).toEqual(['PMOX01', 'GB001', 'PMOE74', 'FT100'])
  })
  it('foraDaLista: prefixos e descrição de embalagem', () => {
    expect(foraDaLista({ codigo: 'PRT1', descricao: '', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'RWSV1', descricao: '', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'X1', descricao: 'Saco plástico', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'X1', descricao: 'Calço de isopor', itemId: null, filhos: [] })).toBe(true)
    expect(foraDaLista({ codigo: 'GB1', descricao: 'Gabinete', itemId: null, filhos: [] })).toBe(false)
  })
})

describe('camada 2 — kitServe', () => {
  const codigos = codigosDaArvore(arvoreDaResposta(RESPOSTA, 'PMOC31'))
  it('serve quando todos os componentes de 1º nível do kit estão em algum nível do produto', () => {
    const kit: NoEstrutura[] = [
      { codigo: 'BIO001', descricao: '', itemId: null, filhos: [] },
      { codigo: 'CB001', descricao: '', itemId: null, filhos: [] },
      { codigo: 'RWSV99', descricao: 'SERVICO', itemId: null, filhos: [] },
      { codigo: 'SC01', descricao: 'SACO', itemId: null, filhos: [] },
    ]
    expect(kitServe(kit, codigos)).toBe(true)
  })
  it('não serve com um componente de fora, nem kit vazio', () => {
    expect(kitServe([{ codigo: 'BIO001', descricao: '', itemId: null, filhos: [] }, { codigo: 'ZZZ', descricao: '', itemId: null, filhos: [] }], codigos)).toBe(false)
    expect(kitServe([], codigos)).toBe(false)
  })
})

describe('pais e busca de itens', () => {
  it('pais: aceita item aninhado ou o código direto; sem duplicar', () => {
    expect(paisDaResposta({ data: [{ item: { codigo: 'PMOE74', descricao: 'KIT' } }, { codigo: 'pmoc31', descricao: 'REL' }, { codigo: 'PMOE74' }] }))
      .toEqual([{ codigo: 'PMOE74', descricao: 'KIT' }, { codigo: 'PMOC31', descricao: 'REL' }])
  })
  it('busca: as linhas do itemMovimento/findFilter viram código + descrição, até o limite', () => {
    const resposta = { data: [{ item: { codigo: 'PRT706', descricao: 'PLACA' } }, { item: { codigo: 'PRT707', descricao: 'PLACA 2' } }, { item: {} }] }
    expect(itensDaBusca(resposta)).toEqual([{ codigo: 'PRT706', descricao: 'PLACA' }, { codigo: 'PRT707', descricao: 'PLACA 2' }])
    expect(itensDaBusca(resposta, 1)).toHaveLength(1)
  })
  it('filtro: termo com cara de código vai no código; o resto na descrição', () => {
    expect(filtroBuscaItem(' prt70 ', '2026-11-26T00:00:00')).toEqual({ codigo: 'PRT70', descricao: '', data: '2026-11-26T00:00:00', exibeItensComSaldoZerado: true })
    expect(filtroBuscaItem('fonte 12v', '2026-11-26T00:00:00')).toMatchObject({ codigo: '', descricao: 'fonte 12v' })
  })
})
