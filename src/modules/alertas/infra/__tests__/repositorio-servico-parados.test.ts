import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioServico } from '../repositorio-servico'

type Resposta = { data: unknown; error: { message: string } | null }
const OK = { error: null }

/** 17:00 de quinta-feira (29/10/2026) em São Paulo (UTC-3). */
const AGORA = new Date('2026-10-29T20:00:00Z')
/** Pronta às 12:00 SP: 5 h de expediente (turno 07:00–17:30). */
const HA_5H = '2026-10-29T15:00:00Z'
/** Pronta às 16:00 SP: 1 h de expediente. */
const HA_1H = '2026-10-29T19:00:00Z'

const TURNO = { regra_id: 'r1', inicio: '07:00:00', fim: '17:30:00' }

function regra(extra: Record<string, unknown> = {}) {
  return { id: 'r1', postos: ['ALMOX'], pmos: [], limite_horas: 2, ...extra }
}

function pend(extra: Record<string, unknown> = {}) {
  return {
    pmo: 'PRT797', op: '8563', tipo: 'caixa', codigo: 'CX1', seq: 1, pecas: 10, lote_id: null,
    amostra: false, ja_lancadas: 0, em: HA_5H, posto: 'ALMOX', em_mais_antiga: null, ...extra,
  }
}

interface Cenario {
  regras?: Resposta
  turnos?: Resposta
  pendencias?: Resposta
  /** Faz a leitura das pendências LANÇAR (rede caindo), em vez de devolver { error }. */
  lancarNasPendencias?: Error
}

function montar(c: Cenario) {
  const rpcs: { nome: string; args: Record<string, unknown> }[] = []
  const tabelas: string[] = []
  function from(tabela: string) {
    tabelas.push(tabela)
    let tipoFiltrado: unknown
    const q = {
      select: () => q,
      is: () => q,
      in: () => q,
      order: () => q,
      eq(col: string, v: unknown) {
        if (col === 'tipo') tipoFiltrado = v
        return q
      },
      then(ok: (v: unknown) => unknown, ruim?: (e: unknown) => unknown) {
        let r: Resposta = { data: [], ...OK }
        if (tabela === 'alerta_regras' && tipoFiltrado === 'parado') {
          r = c.regras ?? { data: [], ...OK }
        } else if (tabela === 'alerta_regra_intervalos') {
          r = c.turnos ?? { data: [TURNO], ...OK }
        }
        return Promise.resolve(r).then(ok, ruim)
      },
    }
    return q
  }
  const sb = {
    from,
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args })
      if (nome === 'sf_almox_pendencias_base') {
        if (c.lancarNasPendencias) throw c.lancarNasPendencias
        return c.pendencias ?? { data: [], ...OK }
      }
      return { data: null, ...OK }
    },
  } as unknown as SupabaseClient
  const avaliar = () => criarRepositorioServico(sb, {} as unknown as NodeJS.ProcessEnv).avaliar()
  const parados = () =>
    rpcs.find((r) => r.nome === 'alerta_avaliar')!.args.p_parados as Record<string, unknown[]>
  return { avaliar, parados, rpcs, tabelas }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(AGORA)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('avaliar — monta o p_parados', () => {
  it('sem regra de parado: p_parados vazio e as pendências nem são lidas', async () => {
    const m = montar({})
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(m.rpcs.some((r) => r.nome === 'sf_almox_pendencias_base')).toBe(false)
  })

  it('uma regra, um item de 5 h e um de 1 h: um grupo com UM item (o de 5 h)', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      pendencias: { data: [pend(), pend({ codigo: 'CX2', seq: 2, em: HA_1H })], ...OK },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({
      r1: [
        {
          pmo: 'PRT797', op: '8563', posto: 'ALMOX', mais_antiga_min: 300,
          itens: [{ tipo: 'caixa', codigo: 'CX1', pecas: 10, minutos: 300 }],
        },
      ],
    })
  })

  it('em_mais_antiga tem prioridade sobre em', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      pendencias: {
        data: [pend({ tipo: 'peca', codigo: 'avulsas', em: HA_1H, em_mais_antiga: HA_5H })],
        ...OK,
      },
    })
    await m.avaliar()
    const g = m.parados().r1 as { mais_antiga_min: number }[]
    expect(g).toHaveLength(1)
    expect(g[0]!.mais_antiga_min).toBe(300)
  })

  it('descarta posto fora de postos e PMO fora do filtro pmos (comparando aparado)', async () => {
    const m = montar({
      regras: { data: [regra({ pmos: [' PRT797 '] })], ...OK },
      pendencias: {
        data: [
          pend({ codigo: 'A', posto: 'OUTRO' }),
          pend({ codigo: 'B', pmo: 'PMOX01', op: '1' }),
          pend({ codigo: 'C', pmo: ' PRT797 ' }),
        ],
        ...OK,
      },
    })
    await m.avaliar()
    const g = m.parados().r1 as { pmo: string; itens: { codigo: string }[] }[]
    expect(g).toHaveLength(1)
    expect(g[0]!.pmo).toBe('PRT797')
    expect(g[0]!.itens.map((i) => i.codigo)).toEqual(['C'])
  })

  it('tudo abaixo do limite: a chave VEM, com array vazio', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      pendencias: { data: [pend({ em: HA_1H })], ...OK },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({ r1: [] })
  })

  it('erro ao ler as pendências: SEM a chave, e a rodada segue com log', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      pendencias: { data: null, error: { message: 'boom' } },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(m.rpcs.some((r) => r.nome === 'alerta_avaliar')).toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it('erro ao ler os turnos: SEM a chave', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      turnos: { data: null, error: { message: 'boom' } },
      pendencias: { data: [pend()], ...OK },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(console.error).toHaveBeenCalled()
  })

  it('regra sem turno cadastrado: relógio corrido e a chave vem', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      turnos: { data: [], ...OK },
      // 3 h corridas atrás (14:00 SP); com turno seria 3 h também, o ponto é a chave vir.
      pendencias: { data: [pend({ em: '2026-10-29T17:00:00Z' })], ...OK },
    })
    await m.avaliar()
    const g = m.parados().r1 as { mais_antiga_min: number }[]
    expect(g).toHaveLength(1)
    expect(g[0]!.mais_antiga_min).toBe(180)
  })

  it('duas regras com limites diferentes: cada uma o seu mapa, pendências lidas UMA vez', async () => {
    const m = montar({
      regras: { data: [regra(), regra({ id: 'r2', limite_horas: 6 })], ...OK },
      turnos: { data: [TURNO, { ...TURNO, regra_id: 'r2' }], ...OK },
      pendencias: { data: [pend()], ...OK },
    })
    await m.avaliar()
    const p = m.parados()
    expect(p.r1).toHaveLength(1)
    expect(p.r2).toEqual([])
    expect(m.rpcs.filter((r) => r.nome === 'sf_almox_pendencias_base')).toHaveLength(1)
  })
})

describe('avaliar — o parado nunca derruba a rodada dos outros tipos', () => {
  it('exceção inesperada ao ler as pendências: avaliar() ainda chama alerta_avaliar com p_parados {}', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      lancarNasPendencias: new Error('fetch failed'),
    })
    await m.avaliar()
    const chamada = m.rpcs.find((r) => r.nome === 'alerta_avaliar')!
    expect(chamada.args.p_parados).toEqual({})
    // os outros mapas continuam no envio
    expect(chamada.args).toHaveProperty('p_blocos')
    expect(chamada.args).toHaveProperty('p_resumos')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[alertas] paradosDaRodada falhou: fetch failed'))
  })

  it('pendência com pmo nulo não lança: a linha é descartada e a rodada segue', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      pendencias: { data: [pend({ pmo: null, codigo: 'RUIM' }), pend({ codigo: 'BOA' })], ...OK },
    })
    await m.avaliar()
    const g = m.parados().r1 as { itens: { codigo: string }[] }[]
    expect(g).toHaveLength(1)
    expect(g[0]!.itens.map((i) => i.codigo)).toEqual(['BOA'])
  })

  it('elemento nulo em pmos da regra não lança', async () => {
    const m = montar({
      regras: { data: [regra({ pmos: [null, 'PRT797'] })], ...OK },
      pendencias: { data: [pend()], ...OK },
    })
    await m.avaliar()
    expect(m.parados().r1).toHaveLength(1)
  })

  it('erro ao ler as regras de parado: p_parados {} e a rodada segue', async () => {
    const m = montar({ regras: { data: null, error: { message: 'boom' } } })
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(console.error).toHaveBeenCalled()
  })

  it('regra com limite_horas ilegível é pulada e logada; a outra, válida, ganha a chave', async () => {
    const m = montar({
      regras: { data: [regra({ id: 'ruim', limite_horas: null }), regra({ id: 'boa' })], ...OK },
      turnos: { data: [{ ...TURNO, regra_id: 'boa' }], ...OK },
      pendencias: { data: [pend()], ...OK },
    })
    await m.avaliar()
    const p = m.parados()
    expect(Object.keys(p)).toEqual(['boa'])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('regra ruim: limite_horas ilegível'))
  })
})
