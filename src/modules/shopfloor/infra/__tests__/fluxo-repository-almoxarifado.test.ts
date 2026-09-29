import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira: aplica os `.eq()` nas linhas da tabela (é o que decide se a caixa aposentada
 * pelo NQA entra na conta), respeita `.range()` como o PostgREST e atende o `count/head` da contagem
 * de caixas fechadas. `sf_ordens` volta pelo `maybeSingle`; a RPC sf_fluxo_op volta o agregado cru.
 */
const MAX_ROWS = 1000
let ordem: Record<string, unknown> | null = null
let registros: Record<string, unknown>[] = []
let caixas: Record<string, unknown>[] = []
let agregados: Record<string, unknown>[] = []
let perfis: Record<string, { temStatus: boolean; recurso: string; exigeManutencao: boolean }> = {}
let consultasEmCaixas = 0

vi.mock('../postos-repository', () => ({ mapaPostoPerfil: async () => perfis }))

function consulta(tabela: string) {
  if (tabela === 'sf_caixas') consultasEmCaixas += 1
  const filtros: [string, unknown][] = []
  let head = false
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    select(_cols?: string, opts?: { count?: string; head?: boolean }) {
      head = opts?.head === true
      return q
    },
    eq(col: string, val: unknown) {
      filtros.push([col, val])
      return q
    },
    neq: () => q,
    order: () => q,
    range(a: number, b: number) {
      de = a
      ate = b
      return q
    },
    maybeSingle: () => Promise.resolve({ data: ordem, error: null }),
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      const fonte = tabela === 'sf_caixas' ? caixas : registros
      const filtrado = fonte.filter((r) => filtros.every(([c, v]) => r[c] === v))
      if (head) return Promise.resolve({ data: null, count: filtrado.length, error: null }).then(ok, erro)
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      return Promise.resolve({ data: filtrado.slice(de, fim), error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from: consulta,
    rpc: async () => ({ data: agregados, error: null }),
  }),
}))

const { carregarFluxoOp } = await import('../fluxo-repository')

const PMO = 'PMOC13'
const OP = '8495'
const CX1 = 'CX[1][2]8495-PMOC13'
const CX2 = 'CX[2][2]8495-PMOC13'

function registro(posto: string, sn: string, caixa = '') {
  return { pmo: PMO, op: OP, posto, numero_serie: sn, numero_serie_norm: sn, status: '', posto_retorno: null, numero_caixa: caixa, data_hora: `2026-09-29T10:00:0${sn}Z`, id: Number(sn) }
}

describe('carregarFluxoOp — caixas do posto de Almoxarifado', () => {
  beforeEach(() => {
    consultasEmCaixas = 0
    perfis = {
      Embalagem: { temStatus: false, recurso: 'caixa', exigeManutencao: false },
      Almoxarifado: { temStatus: false, recurso: 'almoxarifado', exigeManutencao: false },
    }
    ordem = {
      qtd: 4,
      embalagem_individual: false,
      sf_ordem_postos: [{ posto: 'Embalagem', ordem: 1 }, { posto: 'Almoxarifado', ordem: 2 }],
    }
    // 4 peças embaladas em 2 caixas; só a CX[1] foi bipada no Almoxarifado (2 linhas, uma por peça).
    registros = [
      registro('Embalagem', '1', CX1), registro('Embalagem', '2', CX1),
      registro('Embalagem', '3', CX2), registro('Embalagem', '4', CX2),
      registro('Almoxarifado', '1', CX1), registro('Almoxarifado', '2', CX1),
    ]
    caixas = [
      { pmo: PMO, op: OP, seq: 1, fechada: true, revisao: 0 },
      { pmo: PMO, op: OP, seq: 2, fechada: true, revisao: 0 },
    ]
    agregados = [
      { posto: 'Embalagem', wip: 0, registros: 4, aprovadas: 0, reprovadas: 0, retestes: 0, aprovados_primeira: 0, reprovados_sem_reteste: 0, passou_distinto: 4, primeiro_em: null, ultimo_em: null },
      { posto: 'Almoxarifado', wip: 0, registros: 2, aprovadas: 0, reprovadas: 0, retestes: 0, aprovados_primeira: 0, reprovados_sem_reteste: 0, passou_distinto: 2, primeiro_em: null, ultimo_em: null },
    ]
  })

  const doPosto = (r: Awaited<ReturnType<typeof carregarFluxoOp>>, posto: string) => r.agregados.find((a) => a.posto === posto)!

  it('conta CAIXAS distintas (não peças): o bipe da caixa grava uma linha por peça', async () => {
    const r = await carregarFluxoOp(PMO, OP)
    const almox = doPosto(r, 'Almoxarifado')
    expect(almox.caixasBipadas).toBe(1) // 2 linhas, mas 1 caixa
    expect(almox.caixasFechadas).toBe(2)
    // Disponível Produção = as 2 peças da CX[2], que já passaram pela Embalagem e ainda não entraram.
    expect(almox.wip).toBe(2)
  })

  it('a caixa aposentada pela reprova no NQA (revisao > 0) não entra no denominador', async () => {
    caixas.push({ pmo: PMO, op: OP, seq: 3, fechada: true, revisao: 1 }) // virou histórico; a remontagem herda o número
    caixas.push({ pmo: PMO, op: OP, seq: 4, fechada: false, revisao: 0 }) // aberta: não tem quantidade nem pode ser bipada
    const r = await carregarFluxoOp(PMO, OP)
    expect(doPosto(r, 'Almoxarifado').caixasFechadas).toBe(2)
  })

  it('OP de embalagem individual: sem caixa nenhuma, e sem gastar consulta em sf_caixas', async () => {
    ordem = { ...(ordem as object), embalagem_individual: true } as Record<string, unknown>
    const r = await carregarFluxoOp(PMO, OP)
    const almox = doPosto(r, 'Almoxarifado')
    expect(almox.caixasBipadas).toBeUndefined()
    expect(almox.caixasFechadas).toBeUndefined()
    expect(consultasEmCaixas).toBe(0)
  })

  it('REGRESSÃO: a Embalagem também grava numero_caixa, e o agregado dela NÃO recebe caixas', async () => {
    const r = await carregarFluxoOp(PMO, OP)
    const emb = doPosto(r, 'Embalagem')
    expect(emb.caixasBipadas).toBeUndefined()
    expect(emb.caixasFechadas).toBeUndefined()
  })

  it('REGRESSÃO: OP sem posto de Almoxarifado nem consulta sf_caixas (nada muda nessas OPs)', async () => {
    ordem = { qtd: 4, embalagem_individual: false, sf_ordem_postos: [{ posto: 'Embalagem', ordem: 1 }] }
    const r = await carregarFluxoOp(PMO, OP)
    expect(consultasEmCaixas).toBe(0)
    expect(r.agregados.every((a) => a.caixasBipadas === undefined && a.caixasFechadas === undefined)).toBe(true)
  })
})
