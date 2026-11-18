import { describe, expect, it } from 'vitest'
import {
  distribuirPostos, fixarAlmoxarifado, moverPostoEntreTrechos, opsDaPmo, pmosDoEspelho, rotuloPmo, rotuloTrecho,
  trechoManual, trechosDoEspelho, ultimaLeitura, validarCadastro, type CadastroOp, type OpEspelho, type TrechoCadastro,
} from '../cadastro-op'

const op = (numero: number, codigo: string, nivel: number, mae: number | null, extra: Partial<OpEspelho> = {}): OpEspelho => ({
  numero, idCompels: numero, codigo, descricao: `${codigo} desc`, situacao: 'Em Processo', nivel, quantidade: 10,
  quantidadeProduzida: 0, maeNumero: mae, principalNumero: mae === null ? null : 8498, cliente: 'C01',
  dataDocumento: '2026-11-10', ativa: true, lidoEm: '2026-11-18T13:00:00Z', ...extra,
})
const ESPELHO = [
  op(8498, 'PMOC14', 1, null), op(8499, 'PRT420', 2, 8498), op(8500, 'PRT410', 3, 8499),
  op(8510, 'PMOC14', 1, null, { lidoEm: '2026-11-18T13:10:00Z' }), op(8600, 'PMOF52', 2, 8599), op(8601, 'PRT706', 3, 8600),
  op(8700, 'PMOX', 1, null, { ativa: false }),
]

describe('espelho → PMOs e OPs', () => {
  it('só PMOs ativas, com quantas OPs abertas', () => {
    expect(pmosDoEspelho(ESPELHO)).toEqual([
      { pmo: 'PMOC14', descricao: 'PMOC14 desc', abertas: 2 }, { pmo: 'PMOF52', descricao: 'PMOF52 desc', abertas: 1 },
    ])
    expect(rotuloPmo({ pmo: 'PMOC14', descricao: 'PLACA X', abertas: 2 })).toBe('PMOC14 — PLACA X · 2 OPs abertas')
    expect(rotuloPmo({ pmo: 'PMOF52', descricao: 'FONTE', abertas: 1 })).toBe('PMOF52 — FONTE · 1 OP aberta')
  })
  it('OPs abertas da PMO, da mais nova para a mais velha; hora da última leitura', () => {
    expect(opsDaPmo(ESPELHO, 'PMOC14').map((o) => o.numero)).toEqual([8510, 8498])
    expect(ultimaLeitura(ESPELHO)).toBe('2026-11-18T13:10:00Z')
    expect(ultimaLeitura([])).toBeNull()
  })
})

describe('trechos', () => {
  it('as filhas pela cadeia de mães, da mais funda para cima, e a PMO por último', () => {
    const t = trechosDoEspelho(ESPELHO[0]!, ESPELHO)
    expect(t.map((x) => [x.seq, x.codigo, x.tipo, x.compelsOp])).toEqual([[1, 'PRT410', 'prt', '8500'], [2, 'PRT420', 'prt', '8499'], [3, 'PMOC14', 'pmo', '8498']])
    expect(t[2]!.faixas).toEqual([{ sn_ini: '', sn_fim: '' }])
    expect(t[0]!.faixas).toEqual([])
    expect(t.map(rotuloTrecho)).toEqual(['PRT410 (8500)', 'PRT420 (8499)', 'PMOC14 (8498)'])
  })
  it('PMO sem filhas = um trecho só; manual = um trecho sem OP do Compels', () => {
    expect(trechosDoEspelho(ESPELHO[3]!, ESPELHO).map((x) => x.codigo)).toEqual(['PMOC14'])
    expect(trechoManual('PMOZ')).toMatchObject({ seq: 1, codigo: 'PMOZ', tipo: 'pmo', compelsOp: null, faixas: [{ sn_ini: '', sn_fim: '' }] })
    expect(rotuloTrecho({ codigo: 'PMOZ', compelsOp: null })).toBe('PMOZ')
  })
})

describe('postos', () => {
  const T = trechosDoEspelho(ESPELHO[0]!, ESPELHO)
  it('copia pelo código do trecho; o que não casa (OP antiga) vai para a PMO; Almoxarifado fecha a PMO', () => {
    const r = distribuirPostos(T, [
      { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'prt420' },
      { posto: 'Almoxarifado', trechoCodigo: null }, { posto: 'Teste', trechoCodigo: null },
    ], 'Almoxarifado')
    expect(r.map((x) => x.postos)).toEqual([['SPI'], ['Inspeção PTH'], ['Teste', 'Almoxarifado']])
  })
  it('Almoxarifado nunca fica numa PRT', () => {
    const t = T.map((x) => (x.seq === 1 ? { ...x, postos: ['SPI', 'Almoxarifado'] } : x))
    expect(fixarAlmoxarifado(t, 'Almoxarifado').map((x) => x.postos)).toEqual([['SPI'], [], ['Almoxarifado']])
  })
  it('mover entre trechos vizinhos preserva a ordem da rota', () => {
    const base = distribuirPostos(T, [{ posto: 'SPI', trechoCodigo: null }, { posto: 'AOI', trechoCodigo: null }, { posto: 'Teste', trechoCodigo: null }], 'Almoxarifado')
    const a = moverPostoEntreTrechos(base, 3, 'SPI', -1, 'Almoxarifado')
    expect(a.map((x) => x.postos)).toEqual([[], ['SPI'], ['AOI', 'Teste', 'Almoxarifado']])
    const b = moverPostoEntreTrechos(a, 2, 'SPI', -1, 'Almoxarifado')
    expect(b.map((x) => x.postos)).toEqual([['SPI'], [], ['AOI', 'Teste', 'Almoxarifado']])
    expect(moverPostoEntreTrechos(b, 1, 'SPI', 1, 'Almoxarifado').map((x) => x.postos)).toEqual([[], ['SPI'], ['AOI', 'Teste', 'Almoxarifado']])
    expect(moverPostoEntreTrechos(b, 1, 'SPI', -1, 'Almoxarifado')).toBe(b) // não há trecho antes do primeiro
    expect(moverPostoEntreTrechos(b, 3, 'Almoxarifado', -1, 'Almoxarifado')).toBe(b) // o Almoxarifado não sai da PMO
  })
})

describe('validarCadastro', () => {
  const trechos = (over: (t: TrechoCadastro) => Partial<TrechoCadastro> = () => ({})): TrechoCadastro[] =>
    distribuirPostos(trechosDoEspelho(ESPELHO[0]!, ESPELHO), [
      { posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Inspeção PTH', trechoCodigo: 'PRT420' }, { posto: 'Teste', trechoCodigo: null },
    ], 'Almoxarifado').map((t) => ({ ...t, ...(t.tipo === 'pmo' ? { faixas: [{ sn_ini: '1001', sn_fim: '1010' }] } : {}), ...over(t) }))
  const cad = (t: TrechoCadastro[], extra: Partial<CadastroOp> = {}): CadastroOp => ({
    modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', descricao: '', qtd: 10, acp: '', embalagemIndividual: false,
    placasPorPainel: 1, trechos: t, componentes: [], burnin: [], ...extra,
  })
  it('cadastro certo passa', () => { expect(validarCadastro(cad(trechos()))).toEqual({ ok: true }) })
  it('regras de sempre do cabeçalho e das faixas da PMO (validarOrdem)', () => {
    expect(validarCadastro(cad(trechos(), { cliente: '' }))).toEqual({ ok: false, erro: 'Informe o cliente.' })
    expect(validarCadastro(cad(trechos(), { qtd: 9 }))).toMatchObject({ ok: false, erro: expect.stringContaining('A quantidade (9) não bate') })
  })
  it('trecho sem posto', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 2 ? { postos: [] } : {}))))).toEqual({ ok: false, erro: 'O trecho PRT420 (8499) está sem posto.' })
  })
  it('posto repetido entre trechos', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 2 ? { postos: ['SPI'] } : {}))))).toEqual({ ok: false, erro: 'O posto "SPI" está em dois trechos: PRT410 (8500) e PRT420 (8499).' })
  })
  it('série própria: faixa obrigatória, coerente e sem sobrepor outra da OP', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [] } : {}))))).toEqual({ ok: false, erro: 'PRT410 (8500): preencha a faixa da série própria.' })
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: 'A10', sn_fim: 'A1' }] } : {}))))).toMatchObject({ ok: false, erro: expect.stringContaining('PRT410 (8500): faixa 1 inválida') })
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: '1005', sn_fim: '1020' }] } : {}))))).toEqual({ ok: false, erro: 'A faixa 1 de PRT410 (8500) se sobrepõe à faixa 1 de PMOC14 (8498).' })
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: 'A001', sn_fim: 'A010' }] } : {}))))).toEqual({ ok: true })
  })
  it('PRT com "mesma série" ignora faixa digitada', () => {
    expect(validarCadastro(cad(trechos((t) => (t.seq === 1 ? { faixas: [{ sn_ini: 'x', sn_fim: '' }] } : {}))))).toEqual({ ok: true })
  })
  it('a PMO tem que ser o último trecho', () => {
    const t = trechos()
    expect(validarCadastro(cad([t[2]!, t[0]!, t[1]!]))).toEqual({ ok: false, erro: 'A OP da PMO tem que ser o último trecho.' })
  })
  it('espelha o banco: seq repetido, PMO com o maior seq, posto repetido com espaços', () => {
    const t = trechos()
    expect(validarCadastro(cad([{ ...t[0]!, seq: 2 }, t[1]!, t[2]!]))).toEqual({ ok: false, erro: 'Dois trechos estão com o mesmo número de ordem.' })
    expect(validarCadastro(cad([t[0]!, t[1]!, { ...t[2]!, seq: 1 }].map((x, i) => (i === 0 ? { ...x, seq: 5 } : x))))).toEqual({ ok: false, erro: 'A OP da PMO tem que ser o último trecho.' })
    expect(validarCadastro(cad(trechos((x) => (x.seq === 2 ? { postos: [' SPI '] } : {}))))).toEqual({ ok: false, erro: 'O posto "SPI" está em dois trechos: PRT410 (8500) e PRT420 (8499).' })
    expect(validarCadastro(cad(trechos((x) => (x.seq === 2 ? { postos: ['AOI', 'AOI'] } : {}))))).toEqual({ ok: false, erro: 'O posto "AOI" aparece duas vezes no trecho PRT420 (8499).' })
    expect(validarCadastro(cad(trechos((x) => (x.seq === 2 ? { postos: ['  '] } : {}))))).toEqual({ ok: false, erro: 'O trecho PRT420 (8499) está sem posto.' })
  })
  it('série própria: faixas da mesma PRT não se sobrepõem', () => {
    expect(validarCadastro(cad(trechos((x) => (x.seq === 1 ? { snModo: 'proprio', faixas: [{ sn_ini: 'A001', sn_fim: 'A010' }, { sn_ini: 'A005', sn_fim: 'A020' }] } : {}))))).toEqual({ ok: false, erro: 'A faixa 2 de PRT410 (8500) se sobrepõe à faixa 1 de PRT410 (8500).' })
  })
})
