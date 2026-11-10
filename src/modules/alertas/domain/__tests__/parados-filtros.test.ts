import { describe, it, expect } from 'vitest'
import {
  FILTROS_PADRAO, agruparPorOp, agruparPorPosto, filtrarPecas, filtrarPorMenosDe, lerFiltros, lerPecasParadas, opcoesDeHoras,
  ordenarLinhas, postosComPecas, queryDosFiltros, tipoDaPeca, type SnParadoTela,
} from '../parados-filtros'
import type { RegraDoRelatorio } from '../parados-relatorio'

const REGRA: RegraDoRelatorio = {
  id: 'r1', nome: 'R', limiteHoras: 12, postos: ['Teste', 'Embalagem'], pmos: [], soOpsAtivas: false,
  incluirManutencao: false, ativa: true, turnos: [],
}
const AGORA = new Date('2026-11-09T12:00:00Z')
const h = (horas: number) => new Date(AGORA.getTime() - horas * 3600_000)
const sn = (op: string, numeroSerie: string, posto: string, horas: number, extra: Partial<SnParadoTela> = {}): SnParadoTela =>
  ({ pmo: 'PMOT', op, posto, reprovada: false, numeroSerie, pecas: 1, em: h(horas), finalizada: false, ...extra })

describe('lerFiltros', () => {
  it('sem URL e sem regra: o padrão', () => {
    expect(lerFiltros({}, null)).toEqual(FILTROS_PADRAO)
  })
  it('a regra preenche o que a URL não traz', () => {
    expect(lerFiltros({}, REGRA)).toEqual({
      horas: 12, menos: null, situacao: 'todas', postos: ['Teste', 'Embalagem'], tipo: 'posto', agrupar: 'op', ordem: 'antiga',
    })
    expect(lerFiltros({}, { ...REGRA, soOpsAtivas: true, incluirManutencao: true })).toMatchObject({ situacao: 'ativas', tipo: 'todos' })
  })
  it('a URL vence a regra; "*" = todos os postos; valor inválido cai na base', () => {
    expect(lerFiltros({ horas: '72', situacao: 'finalizadas', postos: '*', tipo: 'conserto', agrupar: 'posto', ordem: 'pecas' }, REGRA))
      .toEqual({ horas: 72, menos: null, situacao: 'finalizadas', postos: [], tipo: 'conserto', agrupar: 'posto', ordem: 'pecas' })
    expect(lerFiltros({ horas: '0', situacao: 'x', tipo: 'toString', agrupar: '', ordem: ['nome'] }, null))
      .toEqual({ ...FILTROS_PADRAO, ordem: 'nome' })
    expect(lerFiltros({ horas: '99999' }, null).horas).toBe(24)
    expect(lerFiltros({ postos: ' Teste , ,Inicial' }, null).postos).toEqual(['Teste', 'Inicial'])
  })
  it('"-" deixa o tempo vazio (nulo); menos de vem da URL', () => {
    expect(lerFiltros({ horas: '-', menos: '72' }, REGRA)).toMatchObject({ horas: null, menos: 72 })
    expect(lerFiltros({ menos: '-' }, null).menos).toBeNull()
    expect(lerFiltros({ menos: '0' }, null).menos).toBeNull()
    expect(lerFiltros({ menos: 'abc' }, null).menos).toBeNull()
  })
  it('ida e volta pela query string, com os tempos vazios', () => {
    const f = { ...FILTROS_PADRAO, horas: null, menos: 8 }
    expect(lerFiltros(Object.fromEntries(new URLSearchParams(queryDosFiltros(f, null))), REGRA)).toMatchObject({ horas: null, menos: 8 })
    const v = { ...FILTROS_PADRAO, menos: null }
    expect(lerFiltros(Object.fromEntries(new URLSearchParams(queryDosFiltros(v, null))), null)).toEqual(v)
  })
  it('ida e volta pela query string', () => {
    const f = { ...FILTROS_PADRAO, postos: ['Teste', 'Inspeção NQA'], agrupar: 'posto' as const }
    const q = Object.fromEntries(new URLSearchParams(queryDosFiltros(f, 'r1')))
    expect(q.regra).toBe('r1')
    expect(lerFiltros(q, REGRA)).toEqual(f)
    expect(new URLSearchParams(queryDosFiltros(FILTROS_PADRAO, null)).get('postos')).toBe('*')
  })
})

describe('filtrarPorMenosDe', () => {
  const sns = [sn('1', 'A', 'Teste', 2), sn('1', 'B', 'Teste', 30), sn('1', 'C', 'Teste', 100)]
  it('vazio (nulo) não filtra', () => {
    expect(filtrarPorMenosDe(sns, null, [], AGORA).map((s) => s.numeroSerie)).toEqual(['A', 'B', 'C'])
  })
  it('só as peças com menos do limite', () => {
    expect(filtrarPorMenosDe(sns, 72, [], AGORA).map((s) => s.numeroSerie)).toEqual(['A', 'B'])
    expect(filtrarPorMenosDe(sns, 24, [], AGORA).map((s) => s.numeroSerie)).toEqual(['A'])
  })
  it('exatamente no limite não entra (menos de)', () => {
    expect(filtrarPorMenosDe([sn('1', 'X', 'Teste', 24)], 24, [], AGORA)).toEqual([])
  })
})

describe('opcoesDeHoras', () => {
  it('acrescenta o limite da regra em ordem', () => {
    expect(opcoesDeHoras(24)).toEqual([4, 8, 24, 72, 168])
    expect(opcoesDeHoras(12)).toEqual([4, 8, 12, 24, 72, 168])
  })
})

describe('lerPecasParadas', () => {
  it('lê as linhas e descarta as ilegíveis', () => {
    const r = lerPecasParadas([
      { pmo: ' PMOT ', op: 'A', posto: 'Teste', reprovada: true, numero_serie: 's1', pecas: 4, em: '2026-11-08T10:00:00Z', finalizada: true },
      { pmo: 'PMOT', op: 'A', posto: 'Teste', em: 'lixo' },
      { pmo: '', op: 'A', posto: 'Teste', em: '2026-11-08T10:00:00Z' },
      null,
    ])
    expect(r).toEqual([{ pmo: 'PMOT', op: 'A', posto: 'Teste', reprovada: true, numeroSerie: 's1', pecas: 4,
      em: new Date('2026-11-08T10:00:00Z'), finalizada: true }])
    expect(lerPecasParadas(null)).toEqual([])
  })
})

describe('tipo e filtros da tela', () => {
  const sns = [
    sn('A', 'a1', 'Teste', 30),
    sn('A', 'a2', 'Teste', 40, { reprovada: true }),
    sn('A', 'a3', 'Manutenção', 50),
    sn('B', 'b1', 'Embalagem', 26, { pecas: 3 }),
  ]
  it('reprovada ou na Manutenção = aguardando conserto', () => {
    expect(sns.map(tipoDaPeca)).toEqual(['posto', 'conserto', 'conserto', 'posto'])
    expect(tipoDaPeca({ posto: ' MANUTENÇÃO ', reprovada: false })).toBe('conserto')
  })
  it('filtra por posto e tipo', () => {
    expect(filtrarPecas(sns, { postos: [], tipo: 'todos' })).toHaveLength(4)
    expect(filtrarPecas(sns, { postos: ['Teste'], tipo: 'todos' }).map((s) => s.numeroSerie)).toEqual(['a1', 'a2'])
    expect(filtrarPecas(sns, { postos: [], tipo: 'posto' }).map((s) => s.numeroSerie)).toEqual(['a1', 'b1'])
    expect(filtrarPecas(sns, { postos: ['Teste'], tipo: 'conserto' }).map((s) => s.numeroSerie)).toEqual(['a2'])
  })
  it('postos com peças, por nome', () => {
    expect(postosComPecas(sns)).toEqual([
      { posto: 'Embalagem', pecas: 3 }, { posto: 'Manutenção', pecas: 1 }, { posto: 'Teste', pecas: 2 },
    ])
  })
  it('agrupa por posto somando as OPs', () => {
    const extra = [...sns, sn('C', 'c1', 'Teste', 10, { pecas: 5 })]
    const p = agruparPorPosto(extra, [], AGORA)
    const teste = p.find((x) => x.posto === 'Teste')!
    expect(teste).toMatchObject({ pecas: 7, maisAntigaMin: 40 * 60, consertos: 1 })
    expect(teste.ops).toEqual([{ pmo: 'PMOT', op: 'C', pecas: 5 }, { pmo: 'PMOT', op: 'A', pecas: 2 }])
    expect(teste.sns.map((s) => s.numeroSerie)).toEqual(['a2', 'a1', 'c1'])
  })
  it('agrupa por OP com a situação da OP', () => {
    const ops = agruparPorOp([...sns.slice(0, 3), sn('B', 'b1', 'Embalagem', 26, { finalizada: true, pecas: 4 })], [], AGORA, 'pecas')
    expect(ops.map((o) => [o.op, o.pecas, o.finalizada])).toEqual([['B', 4, true], ['A', 3, false]])
  })
})

describe('ordenarLinhas', () => {
  const linhas = [
    { nome: 'OP10', pecas: 2, maisAntigaMin: 100 },
    { nome: 'OP9', pecas: 5, maisAntigaMin: 50 },
    { nome: 'OP2', pecas: 2, maisAntigaMin: 300 },
  ]
  const nomes = (o: Parameters<typeof ordenarLinhas>[1]) => ordenarLinhas(linhas, o, (l) => l.nome).map((l) => l.nome)
  it('mais antiga, mais peças, nome', () => {
    expect(nomes('antiga')).toEqual(['OP2', 'OP10', 'OP9'])
    expect(nomes('pecas')).toEqual(['OP9', 'OP2', 'OP10'])
    expect(nomes('nome')).toEqual(['OP2', 'OP9', 'OP10'])
  })
})
