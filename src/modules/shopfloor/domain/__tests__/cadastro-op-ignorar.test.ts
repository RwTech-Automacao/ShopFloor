import { describe, expect, it } from 'vitest'
import {
  desfazerIgnorar, distribuirPostos, erroCadeiaCompels, ignoradasParaEnviar, ignorarPrt, moverPostoEntreTrechos, podarHerdados, resumoIgnoradas,
  trechosDoEspelho, trechosParaEnviar, type OpEspelho, type TrechoCadastro,
} from '../cadastro-op'

const op = (numero: number, codigo: string, nivel: number, mae: number | null): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: `${codigo} desc`, situacao: 'Em Processo', nivel, quantidade: 10,
  quantidadeProduzida: 0, maeNumero: mae, principalNumero: null, cliente: 'C01', dataDocumento: '2026-11-10',
  ativa: true, lidoEm: '2026-11-18T13:00:00Z',
})
const ESPELHO = [op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499)]
const ESPERADO = trechosDoEspelho(ESPELHO[0]!, ESPELHO)
// PRT410 (seq 1) = SPI, AOI · PRT420 (seq 2) = PTH · PMOC14 (seq 3) = Teste, Almoxarifado
const T: TrechoCadastro[] = distribuirPostos(ESPERADO, [
  { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'AOI', trechoCodigo: 'PRT410' },
  { posto: 'PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null }, { posto: 'Almoxarifado', trechoCodigo: null },
], 'Almoxarifado')
const postos = (ts: TrechoCadastro[]) => ts.map((t) => [t.codigo, t.postos])

describe('ignorarPrt', () => {
  it('a PMO nunca é ignorada (nem seq que não existe)', () => {
    expect(ignorarPrt(T, 3, 'tirar')).toBeNull()
    expect(ignorarPrt(T, 3, 'manter')).toBeNull()
    expect(ignorarPrt(T, 9, 'tirar')).toBeNull()
  })
  it('"tirar": a PRT e os postos dela saem da rota', () => {
    const r = ignorarPrt(T, 1, 'tirar')!
    expect(postos(r.trechos)).toEqual([['PRT420', ['PTH']], ['PMOC14', ['Teste', 'Almoxarifado']]])
    expect(r.ignorada).toEqual({ trecho: T[0], modo: 'tirar' })
  })
  it('"manter": os postos vão para o começo do trecho seguinte, na mesma ordem', () => {
    expect(postos(ignorarPrt(T, 1, 'manter')!.trechos)).toEqual([['PRT420', ['SPI', 'AOI', 'PTH']], ['PMOC14', ['Teste', 'Almoxarifado']]])
  })
  it('"manter" na última PRT antes da PMO: os postos vão para a PMO', () => {
    expect(postos(ignorarPrt(T, 2, 'manter')!.trechos)).toEqual([['PRT410', ['SPI', 'AOI']], ['PMOC14', ['PTH', 'Teste', 'Almoxarifado']]])
  })
})

describe('desfazerIgnorar', () => {
  it('devolve o estado anterior, nos dois modos', () => {
    for (const modo of ['tirar', 'manter'] as const) {
      for (const seq of [1, 2]) {
        const r = ignorarPrt(T, seq, modo)!
        expect(desfazerIgnorar(r.trechos, r.ignorada)).toEqual(T)
      }
    }
  })
  it('duas ignoradas, desfeitas na ordem inversa: volta ao começo', () => {
    const a = ignorarPrt(T, 1, 'manter')!
    const b = ignorarPrt(a.trechos, 2, 'manter')!
    expect(postos(b.trechos)).toEqual([['PMOC14', ['SPI', 'AOI', 'PTH', 'Teste', 'Almoxarifado']]])
    expect(desfazerIgnorar(desfazerIgnorar(b.trechos, b.ignorada), a.ignorada)).toEqual(T)
  })
  it('duas "manter" vizinhas, desfeitas na ordem em que foram ignoradas', () => {
    const a = ignorarPrt(T, 1, 'manter')!
    const b = ignorarPrt(a.trechos, 2, 'manter')!
    expect(desfazerIgnorar(desfazerIgnorar(b.trechos, a.ignorada), b.ignorada)).toEqual(T)
  })
  it('duas "manter" vizinhas, desfeitas na ordem inversa', () => {
    const a = ignorarPrt(T, 1, 'manter')!
    const b = ignorarPrt(a.trechos, 2, 'manter')!
    expect(desfazerIgnorar(desfazerIgnorar(b.trechos, b.ignorada), a.ignorada)).toEqual(T)
  })
  it('"manter" + "tirar", desfeitas nas duas ordens', () => {
    const a = ignorarPrt(T, 1, 'manter')!
    const b = ignorarPrt(a.trechos, 2, 'tirar')!
    expect(postos(b.trechos)).toEqual([['PMOC14', ['SPI', 'AOI', 'Teste', 'Almoxarifado']]])
    expect(desfazerIgnorar(desfazerIgnorar(b.trechos, a.ignorada), b.ignorada)).toEqual(T)
    expect(desfazerIgnorar(desfazerIgnorar(b.trechos, b.ignorada), a.ignorada)).toEqual(T)
    const c = ignorarPrt(T, 1, 'tirar')!
    const d = ignorarPrt(c.trechos, 2, 'manter')!
    expect(desfazerIgnorar(desfazerIgnorar(d.trechos, c.ignorada), d.ignorada)).toEqual(T)
    expect(desfazerIgnorar(desfazerIgnorar(d.trechos, d.ignorada), c.ignorada)).toEqual(T)
  })
  it('três PRTs ignoradas, desfeitas com a do meio primeiro', () => {
    const esp = [op(1, 'PMO', 1, null), op(2, 'PRTC', 2, 1), op(3, 'PRTB', 3, 2), op(4, 'PRTA', 4, 3)]
    const base = distribuirPostos(trechosDoEspelho(esp[0]!, esp), [
      { posto: 'P1', trechoCodigo: 'PRTA' }, { posto: 'P2', trechoCodigo: 'PRTB' },
      { posto: 'P3', trechoCodigo: 'PRTC' }, { posto: 'P4', trechoCodigo: null },
    ], 'P4')
    const a = ignorarPrt(base, 1, 'manter')!
    const b = ignorarPrt(a.trechos, 2, 'manter')!
    const c = ignorarPrt(b.trechos, 3, 'manter')!
    expect(postos(c.trechos)).toEqual([['PMO', ['P1', 'P2', 'P3', 'P4']]])
    expect(desfazerIgnorar(desfazerIgnorar(desfazerIgnorar(c.trechos, b.ignorada), c.ignorada), a.ignorada)).toEqual(base)
    expect(desfazerIgnorar(desfazerIgnorar(desfazerIgnorar(c.trechos, c.ignorada), a.ignorada), b.ignorada)).toEqual(base)
  })
  it('a PRT que já está nos trechos não entra de novo', () => {
    const r = ignorarPrt(T, 1, 'tirar')!
    expect(desfazerIgnorar(T, r.ignorada)).toBe(T)
  })
})

describe('envio', () => {
  it('seq renumerado sem buraco; sem ignorada, os mesmos objetos', () => {
    const r = ignorarPrt(T, 1, 'tirar')!
    expect(trechosParaEnviar(r.trechos).map((t) => [t.seq, t.codigo])).toEqual([[1, 'PRT420'], [2, 'PMOC14']])
    expect(trechosParaEnviar(T)).toEqual(T)
    expect(ignoradasParaEnviar([r.ignorada])).toEqual([{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }])
  })
})

describe('erroCadeiaCompels', () => {
  const NAO_BATE = 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.'
  const sem = (seq: number) => trechosParaEnviar(ignorarPrt(T, seq, 'manter')!.trechos)
  it('a cadeia inteira bate (como antes)', () => {
    expect(erroCadeiaCompels(ESPERADO, T, [])).toBeNull()
  })
  it('a cadeia sem uma PRT bate quando ela vem nas ignoradas', () => {
    expect(erroCadeiaCompels(ESPERADO, sem(2), [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }])).toBeNull()
    expect(erroCadeiaCompels(ESPERADO, sem(1), [{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }])).toBeNull()
  })
  it('faltar PRT sem dizer que foi ignorada, ou ignorar a que está nos trechos: não bate', () => {
    expect(erroCadeiaCompels(ESPERADO, sem(2), [])).toBe(NAO_BATE)
    expect(erroCadeiaCompels(ESPERADO, T, [{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }])).toBe(NAO_BATE)
  })
  it('a PMO não pode ser ignorada', () => {
    expect(erroCadeiaCompels(ESPERADO, sem(2), [{ codigo: 'PMOC14', compelsOp: '8498', modo: 'tirar' }])).toBe('A OP da PMO não pode ser ignorada.')
  })
  it('ignorada fora da cadeia, repetida ou com escolha inválida: não bate', () => {
    const ig = { codigo: 'PRT420', compelsOp: '8499', modo: 'manter' as const }
    expect(erroCadeiaCompels(ESPERADO, sem(2), [ig, { codigo: 'PRT999', compelsOp: '9999', modo: 'tirar' }])).toBe(NAO_BATE)
    expect(erroCadeiaCompels(ESPERADO, sem(2), [ig, ig])).toBe(NAO_BATE)
    expect(erroCadeiaCompels(ESPERADO, sem(2), [{ ...ig, modo: 'outro' as never }])).toBe(NAO_BATE)
  })
  it('seq com buraco (não renumerado): não bate', () => {
    expect(erroCadeiaCompels(ESPERADO, ignorarPrt(T, 1, 'tirar')!.trechos, [{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }])).toBe(NAO_BATE)
  })
})

describe('resumoIgnoradas', () => {
  it('a linha do log: qual PRT e a escolha', () => {
    expect(resumoIgnoradas([])).toBeNull()
    expect(resumoIgnoradas([{ codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }]))
      .toBe('PRT ignorada: PRT420 (8499) — Manter os postos na rota da OP')
    expect(resumoIgnoradas([{ codigo: 'PRT410', compelsOp: '8500', modo: 'tirar' }, { codigo: 'PRT420', compelsOp: '8499', modo: 'manter' }]))
      .toBe('PRTs ignoradas: PRT410 (8500) — Tirar os postos da rota; PRT420 (8499) — Manter os postos na rota da OP')
  })
})

describe('herdados em ações manuais', () => {
  it('mover o posto herdado para outro trecho tira-o dos herdados do trecho de origem', () => {
    const r = ignorarPrt(T, 2, 'manter')!
    const pmo = r.trechos.find((t) => t.tipo === 'pmo')!
    expect(pmo.herdados).toEqual(['PTH'])
    const movido = moverPostoEntreTrechos(r.trechos, pmo.seq, 'PTH', -1, 'Almoxarifado')
    expect(movido.find((t) => t.tipo === 'pmo')!.herdados ?? []).toEqual([])
    expect(postos(movido)).toEqual([['PRT410', ['SPI', 'AOI', 'PTH']], ['PMOC14', ['Teste', 'Almoxarifado']]])
  })

  it('podarHerdados tira os herdados que já não estão nos postos', () => {
    const t: TrechoCadastro = { ...T[2]!, postos: ['PTH', 'Teste'], herdados: ['PTH', 'SPI'] }
    expect(podarHerdados(t).herdados).toEqual(['PTH'])
    expect(podarHerdados({ ...t, postos: ['Teste'] }).herdados).toBeUndefined()
    expect(podarHerdados(T[0]!)).toBe(T[0])
  })
})
