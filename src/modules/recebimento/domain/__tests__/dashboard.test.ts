import { describe, expect, it } from 'vitest'
import {
  FILTROS_LIMPOS,
  aplicarClique,
  diaValido,
  etiquetasDosFiltros,
  filtrosDaUrl,
  formatarPercentual,
  hojeSp,
  janelaPadrao,
  percentual,
  rotuloFornecedor,
  semFiltro,
  textoRodape,
  urlDosFiltros,
  type FiltrosDashboard,
  type TotaisDashboard,
} from '../dashboard'

// 15/10/2026, meio-dia em São Paulo.
const AGORA = new Date('2026-10-15T15:00:00Z')
const PADRAO = { de: '2026-07-18', ate: '2026-10-15' }

describe('percentual', () => {
  it('uma casa, arredondando', () => {
    expect(percentual(137, 1284)).toBe(10.7)
    expect(percentual(1, 3)).toBe(33.3)
    expect(percentual(0, 5)).toBe(0)
  })
  it('NÃO arredonda para 100 quando não é 100', () => {
    expect(percentual(9999, 10000)).toBe(99.9)
    expect(percentual(19999, 20000)).toBe(99.9)
  })
  it('100 só quando é tudo', () => {
    expect(percentual(5, 5)).toBe(100)
  })
  it('total zero não tem porcentagem', () => {
    expect(percentual(0, 0)).toBeNull()
    expect(percentual(3, 0)).toBeNull()
  })
  it('formata em pt-BR', () => {
    expect(formatarPercentual(10.7)).toBe('10,7%')
    expect(formatarPercentual(100)).toBe('100%')
    expect(formatarPercentual(99.9)).toBe('99,9%')
    expect(formatarPercentual(null)).toBe('—')
  })
})

describe('recorte padrão de 90 dias', () => {
  it('são os últimos 90 dias contando hoje', () => {
    expect(janelaPadrao(AGORA)).toEqual(PADRAO)
  })
  it('hoje é o dia de São Paulo, não o do servidor em UTC', () => {
    // 02:30 UTC do dia 16 ainda é 23:30 do dia 15 em São Paulo.
    expect(hojeSp(new Date('2026-10-16T02:30:00Z'))).toBe('2026-10-15')
    expect(janelaPadrao(new Date('2026-10-16T02:30:00Z')).ate).toBe('2026-10-15')
  })
  it('atravessa a virada do ano', () => {
    expect(janelaPadrao(new Date('2027-01-10T15:00:00Z'))).toEqual({ de: '2026-10-13', ate: '2027-01-10' })
  })
})

describe('filtros ↔ URL', () => {
  it('URL vazia = os 90 dias e nada mais', () => {
    expect(filtrosDaUrl({}, AGORA)).toEqual({ ...FILTROS_LIMPOS, ...PADRAO })
  })
  it('lê todos os filtros, aparando', () => {
    expect(filtrosDaUrl({
      fornecedor: ' Panasonic ', comprador: 'Joana', emb: 'EMB390', codigo: 'CAPJ91',
      de: '2026-09-01', ate: '2026-09-30', sinal: 'negativa',
    }, AGORA)).toEqual({
      fornecedor: 'Panasonic', comprador: 'Joana', emb: 'EMB390', codigo: 'CAPJ91',
      de: '2026-09-01', ate: '2026-09-30', sinal: 'negativa',
    })
  })
  it('periodo=tudo tira o recorte de data, mesmo com de/ate na URL', () => {
    const f = filtrosDaUrl({ periodo: 'tudo', de: '2026-09-01' }, AGORA)
    expect(f.de).toBe('')
    expect(f.ate).toBe('')
  })
  it('um lado só da data fica aberto do outro', () => {
    expect(filtrosDaUrl({ de: '2026-09-01' }, AGORA)).toMatchObject({ de: '2026-09-01', ate: '' })
    expect(filtrosDaUrl({ ate: '2026-09-30' }, AGORA)).toMatchObject({ de: '', ate: '2026-09-30' })
  })
  it('data inválida e sinal desconhecido são ignorados', () => {
    expect(filtrosDaUrl({ de: '2026-02-30', ate: 'ontem', sinal: 'zero' }, AGORA))
      .toEqual({ ...FILTROS_LIMPOS, ...PADRAO })
  })
  it('valor repetido na URL: vale o primeiro', () => {
    expect(filtrosDaUrl({ emb: ['EMB1', 'EMB2'] }, AGORA).emb).toBe('EMB1')
  })
  it('o padrão NÃO vai para a URL; sem recorte vira periodo=tudo', () => {
    expect(urlDosFiltros({ ...FILTROS_LIMPOS, ...PADRAO }, AGORA)).toBe('')
    expect(urlDosFiltros(FILTROS_LIMPOS, AGORA)).toBe('periodo=tudo')
  })
  it('ida e volta reproduz os filtros (o link compartilhado reproduz a tela)', () => {
    const casos: FiltrosDashboard[] = [
      { ...FILTROS_LIMPOS, ...PADRAO },
      FILTROS_LIMPOS,
      { fornecedor: 'ACME & Filhos', comprador: 'Pedro', emb: 'EMB 1', codigo: 'X/1', de: '2026-09-07', ate: '2026-09-13', sinal: 'positiva' },
      { ...FILTROS_LIMPOS, de: '2026-09-01', ate: '' },
      { ...FILTROS_LIMPOS, de: '', ate: '2026-09-30' },
    ]
    for (const f of casos) {
      const sp = Object.fromEntries(new URLSearchParams(urlDosFiltros(f, AGORA)))
      expect(filtrosDaUrl(sp, AGORA), JSON.stringify(f)).toEqual(f)
    }
  })
  it('diaValido recusa o que não existe no calendário', () => {
    expect(diaValido('2026-09-30')).toBe(true)
    expect(diaValido('2028-02-29')).toBe(true)
    expect(diaValido('2026-02-29')).toBe(false)
    expect(diaValido('2026-9-3')).toBe(false)
    expect(diaValido('')).toBe(false)
  })
})

describe('cliques nos gráficos', () => {
  const f: FiltrosDashboard = { ...FILTROS_LIMPOS, ...PADRAO }
  it('fornecedor aplica o filtro', () => {
    expect(aplicarClique(f, { fornecedor: 'Vishay' }).fornecedor).toBe('Vishay')
  })
  it('fornecedor em branco não vira filtro', () => {
    expect(aplicarClique(f, { fornecedor: '' })).toEqual(f)
  })
  it('semana vira o recorte de segunda a domingo', () => {
    expect(aplicarClique(f, { semana: '2026-09-07' })).toMatchObject({ de: '2026-09-07', ate: '2026-09-13' })
  })
  it('sinal aplica só positivas / só negativas', () => {
    expect(aplicarClique(f, { sinal: 'negativa' }).sinal).toBe('negativa')
  })
})

describe('etiquetas dos filtros aplicados', () => {
  it('uma por filtro, na ordem da barra', () => {
    expect(etiquetasDosFiltros({
      fornecedor: 'Vishay', comprador: 'Pedro', emb: 'EMB2', codigo: 'RES1',
      de: '2026-09-07', ate: '2026-09-13', sinal: 'positiva',
    })).toEqual([
      { chave: 'fornecedor', texto: 'Fornecedor: Vishay' },
      { chave: 'comprador', texto: 'Comprador: Pedro' },
      { chave: 'emb', texto: 'EMB: EMB2' },
      { chave: 'codigo', texto: 'Código: RES1' },
      { chave: 'periodo', texto: 'Chegada: 07/09/2026 a 13/09/2026' },
      { chave: 'sinal', texto: 'Só positivas' },
    ])
  })
  it('período de um lado só', () => {
    expect(etiquetasDosFiltros({ ...FILTROS_LIMPOS, de: '2026-09-01' })[0]!.texto).toBe('Chegada: a partir de 01/09/2026')
    expect(etiquetasDosFiltros({ ...FILTROS_LIMPOS, ate: '2026-09-30' })[0]!.texto).toBe('Chegada: até 30/09/2026')
  })
  it('sem filtro, sem etiqueta', () => {
    expect(etiquetasDosFiltros(FILTROS_LIMPOS)).toEqual([])
  })
  it('tirar o período deixa sem recorte de data; tirar o resto zera só ele', () => {
    const f: FiltrosDashboard = { ...FILTROS_LIMPOS, ...PADRAO, emb: 'EMB2', sinal: 'negativa' }
    expect(semFiltro(f, 'periodo')).toEqual({ ...f, de: '', ate: '' })
    expect(semFiltro(f, 'emb')).toEqual({ ...f, emb: '' })
    expect(semFiltro(f, 'sinal')).toEqual({ ...f, sinal: '' })
  })
})

describe('rodapé e rótulos', () => {
  const t: TotaisDashboard = {
    itens: 1284, comDivergencia: 137, semJustificativa: 40, positivas: 80, negativas: 57,
    embs: 42, foraDoRecortePorData: 0,
  }
  it('o texto da spec', () => {
    expect(textoRodape(t)).toBe('137 de 1.284 itens (10,7%) em 42 EMBs')
  })
  it('diz quantos ficaram fora do período', () => {
    expect(textoRodape({ ...t, foraDoRecortePorData: 12 }))
      .toBe('137 de 1.284 itens (10,7%) em 42 EMBs. 12 itens sem data de chegada ficaram fora do período.')
    expect(textoRodape({ ...t, foraDoRecortePorData: 1 }))
      .toBe('137 de 1.284 itens (10,7%) em 42 EMBs. 1 item sem data de chegada ficou fora do período.')
  })
  it('singular e recorte vazio', () => {
    expect(textoRodape({ ...t, itens: 1, comDivergencia: 1, embs: 1 })).toBe('1 de 1 item (100%) em 1 EMB')
    expect(textoRodape({ ...t, itens: 0, comDivergencia: 0, embs: 0 })).toBe('Nenhum item neste recorte.')
  })
  it('fornecedor em branco tem nome na tela', () => {
    expect(rotuloFornecedor('')).toBe('(sem fornecedor)')
    expect(rotuloFornecedor('Vishay')).toBe('Vishay')
  })
})
