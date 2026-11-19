// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Banco de mentira só com o que o atualizarOrdem toca. Reproduz o trigger da 0181 (sn_ini vazio apaga TODAS as faixas;
 * senão reescreve a seq 1) e as recusas da sf_ordem_regravar_faixas (0184) — o bastante para provar a ORDEM das escritas.
 */
type Faixa = { seq: number; sn_ini: string; sn_fim: string; trecho_seq: number | null }
const db = vi.hoisted(() => ({
  log: [] as string[],
  trechos: [] as { seq: number; codigo: string; tipo: string; sn_modo?: string }[],
  postos: [] as { posto: string; trecho_seq: number | null }[],
  faixas: [] as { seq: number; sn_ini: string; sn_fim: string; trecho_seq: number | null }[],
  ordem: { sn_ini: '', sn_fim: '' },
}))

function regravarFaixas(entrada: { sn_ini: string; sn_fim: string }[]): void {
  const pmo = db.trechos.find((t) => t.tipo === 'pmo')?.seq ?? null
  if (pmo !== null && entrada.length === 0) throw { message: `TRECHO_SEM_FAIXA:${db.trechos.find((t) => t.seq === pmo)?.codigo}` }
  const prt = db.faixas.filter((f) => f.trecho_seq !== null && f.trecho_seq !== pmo)
  db.faixas = [...entrada.map((f) => ({ ...f, trecho_seq: pmo })), ...prt].map((f, i) => ({ ...f, seq: i + 1 }))
}

function tabela(nome: string) {
  const fim = (r: unknown = { data: null, error: null }) => Promise.resolve(r)
  return {
    select: () => ({
      eq: () => {
        db.log.push(`select ${nome}`)
        if (nome === 'sf_ordem_trechos') return fim({ data: db.trechos, error: null })
        if (nome === 'sf_ordem_postos') return fim({ data: db.postos, error: null })
        return fim()
      },
    }),
    delete: () => ({ eq: () => { db.log.push(`delete ${nome}`); return fim() } }),
    insert: () => { db.log.push(`insert ${nome}`); return fim() },
    update: (v: { sn_ini: string; sn_fim: string }) => ({
      eq: () => {
        db.log.push(`update ${nome}`)
        if (nome === 'sf_ordens') {
          db.ordem = { sn_ini: v.sn_ini, sn_fim: v.sn_fim }
          // trigger da 0181
          if (v.sn_ini === '' || v.sn_fim === '') db.faixas = []
          else db.faixas = db.faixas.map((f) => (f.seq === 1 ? { ...f, sn_ini: v.sn_ini, sn_fim: v.sn_fim } : f))
        }
        return fim()
      },
    }),
  }
}

const rpc = vi.fn(async (nome: string, args: { p_faixas?: { sn_ini: string; sn_fim: string }[]; p_postos?: string[] }) => {
  db.log.push(`rpc ${nome}`)
  try {
    if (nome === 'sf_ordem_regravar_faixas') regravarFaixas(args.p_faixas ?? [])
  } catch (e) {
    return { data: null, error: e }
  }
  return { data: null, error: null }
})
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from: tabela, rpc }) }))

import { atualizarOrdem, trechoQueFicariaSemPosto, type DadosOrdem } from '../ordem-repository'

const dados = (sn_ini: string, sn_fim: string): DadosOrdem => ({
  pmo: 'PMOC14', op: '8498', cliente: 'C', qtd: 10, descricao: '', acp: '', status: 'ATIVA', sn_ini, sn_fim,
  embalagem_individual: false, placas_por_painel: 1, finalizada_por: null,
})
const PRT_PROPRIA: Faixa = { seq: 2, sn_ini: 'P001', sn_fim: 'P099', trecho_seq: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  db.log = []
  db.trechos = [{ seq: 1, codigo: 'PRT410', tipo: 'prt', sn_modo: 'proprio' }, { seq: 2, codigo: 'PMOC14', tipo: 'pmo' }]
  db.postos = [{ posto: 'SPI', trecho_seq: 1 }, { posto: 'Inspeção AOI TOP', trecho_seq: 1 }, { posto: 'Teste', trecho_seq: 2 }, { posto: 'Almoxarifado', trecho_seq: 2 }]
  db.faixas = [{ seq: 1, sn_ini: '100', sn_fim: '199', trecho_seq: 2 }, PRT_PROPRIA]
  db.ordem = { sn_ini: '100', sn_fim: '199' }
})

describe('atualizarOrdem numa OP com trechos', () => {
  it('as funções que podem recusar vêm antes de tudo, e a sf_ordens por último', async () => {
    await atualizarOrdem('id-1', dados('200', '299'), ['SPI', 'Inspeção AOI TOP', 'Teste', 'Almoxarifado'], [], [], [{ sn_ini: '200', sn_fim: '299' }])
    const escritas = db.log.filter((l) => !l.startsWith('select'))
    expect(escritas[0]).toBe('rpc sf_ordem_regravar_faixas')
    expect(escritas[1]).toBe('rpc sf_ordem_regravar_postos')
    expect(escritas.at(-1)).toBe('update sf_ordens')
    expect(db.log).not.toContain('delete sf_ordem_postos')
    expect(db.log).not.toContain('delete sf_ordem_faixas')
  })

  it("a faixa 'proprio' da PRT sobrevive à edição (trigger da 0181 incluso)", async () => {
    await atualizarOrdem('id-1', dados('200', '299'), ['SPI', 'Inspeção AOI TOP', 'Teste', 'Almoxarifado'], [], [], [{ sn_ini: '200', sn_fim: '299' }])
    expect(db.faixas).toEqual([
      { seq: 1, sn_ini: '200', sn_fim: '299', trecho_seq: 2 },
      { seq: 2, sn_ini: 'P001', sn_fim: 'P099', trecho_seq: 1 },
    ])
  })

  it('faixa da PMO vazia: a função recusa e NADA é gravado (nem a sf_ordens, cujo trigger apagaria a da PRT)', async () => {
    await expect(atualizarOrdem('id-1', dados('', ''), ['SPI', 'Inspeção AOI TOP', 'Teste', 'Almoxarifado'], [], [], [])).rejects.toMatchObject({ message: 'TRECHO_SEM_FAIXA:PMOC14' })
    expect(db.log.filter((l) => !l.startsWith('select'))).toEqual(['rpc sf_ordem_regravar_faixas'])
    expect(db.faixas).toContainEqual(PRT_PROPRIA)
    expect(db.ordem).toEqual({ sn_ini: '100', sn_fim: '199' })
  })

  it('trecho que ficaria sem posto: recusado antes da primeira escrita', async () => {
    await expect(atualizarOrdem('id-1', dados('200', '299'), ['Teste', 'Almoxarifado'], [], [], [{ sn_ini: '200', sn_fim: '299' }])).rejects.toThrow('TRECHO_SEM_POSTO:PRT410')
    expect(db.log.every((l) => l.startsWith('select'))).toBe(true)
    expect(db.faixas).toContainEqual(PRT_PROPRIA)
  })
})

describe('atualizarOrdem com a edição por trecho (0194)', () => {
  const TRECHOS = [
    { seq: 1, postos: ['SPI'], sn_modo: 'proprio' as const, faixas: [{ sn_ini: 'P001', sn_fim: 'P099' }] },
    { seq: 2, postos: ['Inspeção AOI TOP', 'Teste', 'Almoxarifado'], sn_modo: 'mesmo' as const, faixas: [{ sn_ini: '200', sn_fim: '299' }] },
  ]
  it('uma RPC só para rota/série/faixas, antes de qualquer outra escrita; a sf_ordens por último', async () => {
    await atualizarOrdem('id-1', dados('200', '299'), ['SPI', 'Inspeção AOI TOP', 'Teste', 'Almoxarifado'], [], [], [{ sn_ini: '200', sn_fim: '299' }], TRECHOS)
    const escritas = db.log.filter((l) => !l.startsWith('select'))
    expect(escritas[0]).toBe('rpc sf_ordem_regravar_trechos')
    expect(escritas).not.toContain('rpc sf_ordem_regravar_postos')
    expect(escritas).not.toContain('rpc sf_ordem_regravar_faixas')
    expect(escritas.at(-1)).toBe('update sf_ordens')
    expect(rpc).toHaveBeenCalledWith('sf_ordem_regravar_trechos', { p_ordem_id: 'id-1', p_trechos: TRECHOS })
  })
  it('recusa da RPC: nada mais é gravado', async () => {
    rpc.mockImplementationOnce(async (nome: string) => { db.log.push(`rpc ${nome}`); return { data: null, error: { message: 'POSTO_COM_REGISTROS:SPI' } } as never })
    await expect(atualizarOrdem('id-1', dados('200', '299'), [], [], [], [], TRECHOS)).rejects.toMatchObject({ message: 'POSTO_COM_REGISTROS:SPI' })
    expect(db.log.filter((l) => !l.startsWith('select'))).toEqual(['rpc sf_ordem_regravar_trechos'])
  })
  it('OP sem trechos não aceita a edição por trecho', async () => {
    db.trechos = []
    await expect(atualizarOrdem('id-1', dados('1', '9'), [], [], [], [], TRECHOS)).rejects.toThrow('OP_SEM_TRECHOS')
    expect(db.log.every((l) => l.startsWith('select'))).toBe(true)
  })
})

describe('atualizarOrdem numa OP antiga (sem trechos)', () => {
  it('a sf_ordens primeiro (como antes), depois postos e faixas pelas funções', async () => {
    db.trechos = []
    db.faixas = [{ seq: 1, sn_ini: '100', sn_fim: '199', trecho_seq: null }]
    await atualizarOrdem('id-1', dados('1', '9'), ['Teste'], [], [], [{ sn_ini: '1', sn_fim: '9' }])
    const escritas = db.log.filter((l) => !l.startsWith('select'))
    expect(escritas[0]).toBe('update sf_ordens')
    expect(escritas).toContain('rpc sf_ordem_regravar_postos')
    expect(escritas.at(-1)).toBe('rpc sf_ordem_regravar_faixas')
  })
})

describe('trechoQueFicariaSemPosto', () => {
  const trechos = [{ seq: 1, codigo: 'PRT410', tipo: 'prt' }, { seq: 2, codigo: 'PMOC14', tipo: 'pmo' }]
  const antigos = [{ posto: 'SPI', trecho_seq: 1 }, { posto: 'Teste', trecho_seq: 2 }]
  it('posto novo entra no trecho da PMO', () => {
    expect(trechoQueFicariaSemPosto(['SPI', 'Embalagem'], antigos, trechos)).toBeNull()
  })
  it('tirar o último posto da PRT', () => {
    expect(trechoQueFicariaSemPosto(['Teste', 'Embalagem'], antigos, trechos)).toBe('PRT410')
  })
})
