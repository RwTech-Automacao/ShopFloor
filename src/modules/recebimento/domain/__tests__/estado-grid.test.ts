import { describe, expect, it } from 'vitest'
import {
  ESTADO_GRID_PADRAO,
  FILTROS_RAPIDOS,
  codificarEstadoGrid,
  decodificarEstadoGrid,
  faixaDoMes,
  rotulosOrdenacao,
  type EstadoGrid,
} from '../estado-grid'

const COLUNAS = ['numero', 'fornecedor', 'data_chegada', 'status']

describe('codificar/decodificarEstadoGrid', () => {
  it('faz ida e volta preservando o estado', () => {
    const estado: EstadoGrid = {
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 3,
      tamanho: 100,
      filtros: { fornecedor: { texto: 'ACME' }, status: { valores: ['Aprovado'] } },
      rapido: 'nao_resolvidas',
    }
    expect(decodificarEstadoGrid(codificarEstadoGrid(estado), COLUNAS)).toEqual(estado)
  })

  it('param ausente → padrão', () => {
    expect(decodificarEstadoGrid(undefined, COLUNAS)).toEqual(ESTADO_GRID_PADRAO)
  })

  it('param inválido (não é JSON) → padrão, sem quebrar', () => {
    expect(decodificarEstadoGrid('%%%nao-e-json%%%', COLUNAS)).toEqual(ESTADO_GRID_PADRAO)
  })

  it('coluna de ordenação fora da whitelist → volta ao padrão', () => {
    const param = codificarEstadoGrid({ ...ESTADO_GRID_PADRAO, ordenar: 'coluna_maliciosa' })
    expect(decodificarEstadoGrid(param, COLUNAS).ordenar).toBe(ESTADO_GRID_PADRAO.ordenar)
  })

  it('filtro em coluna fora da whitelist é descartado', () => {
    const param = codificarEstadoGrid({
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: 'ok' }, coluna_maliciosa: { texto: 'x' } },
    })
    expect(decodificarEstadoGrid(param, COLUNAS).filtros).toEqual({ fornecedor: { texto: 'ok' } })
  })

  it('página negativa → 0 e direção inválida → desc', () => {
    const param = encodeURIComponent(JSON.stringify({ ordenar: 'numero', direcao: 'xxx', pagina: -5, tamanho: 50, filtros: {} }))
    const e = decodificarEstadoGrid(param, COLUNAS)
    expect(e.pagina).toBe(0)
    expect(e.direcao).toBe('desc')
  })

  it('tamanho fora dos permitidos → padrão (50)', () => {
    const param = codificarEstadoGrid({ ...ESTADO_GRID_PADRAO, tamanho: 999 })
    expect(decodificarEstadoGrid(param, COLUNAS).tamanho).toBe(50)
  })

  it('filtro vazio é descartado (não vira filtro que não filtra nada)', () => {
    const param = codificarEstadoGrid({
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: '   ' }, status: { valores: [] } },
    })
    expect(decodificarEstadoGrid(param, COLUNAS).filtros).toEqual({})
  })

  it('preserva texto com % e acentos (o decode duplo apagava o estado)', () => {
    const estado: EstadoGrid = {
      ...ESTADO_GRID_PADRAO,
      filtros: { fornecedor: { texto: 'ALGODÃO 100%' } },
    }
    expect(decodificarEstadoGrid(codificarEstadoGrid(estado), COLUNAS)).toEqual(estado)
  })
})

describe('filtro rápido de divergência', () => {
  it.each(['divergencias', 'positivas', 'negativas', 'resolvidas', 'nao_resolvidas'])('aceita %s', (valor) => {
    const param = JSON.stringify({ ...ESTADO_GRID_PADRAO, rapido: valor })
    expect(decodificarEstadoGrid(param, COLUNAS).rapido).toBe(valor)
  })

  it('o conjunto fechado tem os cinco valores, na ordem da tela', () => {
    expect([...FILTROS_RAPIDOS]).toEqual(['divergencias', 'positivas', 'negativas', 'resolvidas', 'nao_resolvidas'])
  })

  it('o padrão é "Divergências Não Resolvidas"', () => {
    expect(ESTADO_GRID_PADRAO.rapido).toBe('nao_resolvidas')
  })

  it('sem parâmetro na URL, o padrão se aplica', () => {
    expect(decodificarEstadoGrid(undefined, COLUNAS).rapido).toBe('nao_resolvidas')
  })

  it('link antigo (com `g`, mas sem a chave rapido) também recebe o padrão', () => {
    const param = JSON.stringify({ ordenar: 'numero', direcao: 'desc', pagina: 0, tamanho: 50, filtros: {} })
    expect(decodificarEstadoGrid(param, COLUNAS).rapido).toBe('nao_resolvidas')
  })

  it('"nenhum" é o desligado explícito: o padrão NÃO volta', () => {
    const param = JSON.stringify({ ...ESTADO_GRID_PADRAO, rapido: 'nenhum' })
    expect(decodificarEstadoGrid(param, COLUNAS).rapido).toBe('nenhum')
  })

  it('ida e volta preserva o desligado (paginação, ordenação e link compartilhado)', () => {
    const estado: EstadoGrid = { ...ESTADO_GRID_PADRAO, pagina: 3, rapido: 'nenhum' }
    expect(decodificarEstadoGrid(codificarEstadoGrid(estado), COLUNAS)).toEqual(estado)
  })

  // O `?g=` é digitável: qualquer coisa fora do conjunto fechado cai no padrão — nunca chega
  // à consulta nem derruba a tela.
  it.each([
    ['valor fora do conjunto', 'tudo'],
    ['nome de coluna', 'divergencia_num'],
    ['sinal cru', '>0'],
    ['número', 7],
    ['objeto', { rapido: 'positivas' }],
    ['array', ['positivas']],
    ['nulo', null],
    ['booleano', true],
  ])('descarta %s, caindo no padrão', (_nome, valor) => {
    const param = JSON.stringify({ ...ESTADO_GRID_PADRAO, rapido: valor })
    const estado = decodificarEstadoGrid(param, COLUNAS)
    expect(estado.rapido).toBe('nao_resolvidas')
    // O resto do estado continua de pé: descartar o lixo não pode zerar a tela.
    expect(estado.ordenar).toBe(ESTADO_GRID_PADRAO.ordenar)
    expect(estado.tamanho).toBe(ESTADO_GRID_PADRAO.tamanho)
  })

  it('faz ida e volta preservando o filtro rápido junto com filtro de coluna e ordenação', () => {
    const estado: EstadoGrid = {
      ordenar: 'fornecedor',
      direcao: 'asc',
      pagina: 2,
      tamanho: 100,
      filtros: { fornecedor: { texto: 'ACME' } },
      rapido: 'negativas',
    }
    expect(decodificarEstadoGrid(codificarEstadoGrid(estado), COLUNAS)).toEqual(estado)
  })
})

describe('faixaDoMes', () => {
  it('mês vira a faixa [primeiro dia, primeiro dia do mês seguinte)', () => {
    expect(faixaDoMes('2026-07')).toEqual({ inicio: '2026-07-01', fim: '2026-08-01' })
  })
  it('dezembro vira janeiro do ano seguinte', () => {
    expect(faixaDoMes('2026-12')).toEqual({ inicio: '2026-12-01', fim: '2027-01-01' })
  })
  it('sem_data não tem faixa (é filtro de nulo)', () => {
    expect(faixaDoMes('sem_data')).toBeNull()
  })
  it('valor inválido não tem faixa', () => {
    expect(faixaDoMes('abacaxi')).toBeNull()
  })
})

describe('rotulosOrdenacao', () => {
  it('texto → alfabético', () => {
    expect(rotulosOrdenacao('texto')).toEqual({
      asc: 'Ordenar de A a Z',
      desc: 'Ordenar de Z a A',
    })
  })

  it('lista → alfabético (é texto de uma lista suspensa)', () => {
    expect(rotulosOrdenacao('lista')).toEqual({
      asc: 'Ordenar de A a Z',
      desc: 'Ordenar de Z a A',
    })
  })

  it('numero → menor/maior (dizer "A a Z" num número não faz sentido)', () => {
    expect(rotulosOrdenacao('numero')).toEqual({
      asc: 'Do menor para o maior',
      desc: 'Do maior para o menor',
    })
  })

  it('data → mais antiga/mais recente', () => {
    expect(rotulosOrdenacao('data')).toEqual({
      asc: 'Da mais antiga para a mais recente',
      desc: 'Da mais recente para a mais antiga',
    })
  })
})
