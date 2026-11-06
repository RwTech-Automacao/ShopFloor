import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioServico } from '../repositorio-servico'

type Resposta = { data: unknown; error: { message: string } | null }
const OK = { error: null }

/** 17:00 de quinta-feira (29/10/2026) em São Paulo (UTC-3). */
const AGORA = new Date('2026-10-29T20:00:00Z')
/** Parada desde as 12:00 SP: 5 h de expediente (turno 07:00–17:30). */
const HA_5H = '2026-10-29T15:00:00Z'

const TURNO = { regra_id: 'r1', inicio: '07:00:00', fim: '17:30:00' }

function regra(extra: Record<string, unknown> = {}) {
  return {
    id: 'r1', postos: ['Teste', 'Embalagem'], pmos: [], limite_horas: 2, so_ops_ativas: true,
    incluir_manutencao: true, ...extra,
  }
}

/** Uma linha de `alerta_travados` (0172). */
function grupo(extra: Record<string, unknown> = {}) {
  return {
    pmo: 'PRT797', op: '8563', posto: 'Teste', reprovada: false, pecas: 4, em: HA_5H,
    amostras: ['258001', '258002'], ...extra,
  }
}

interface Cenario {
  regras?: Resposta
  turnos?: Resposta
  /** Resposta por regra (id) ou uma só para todas. */
  travados?: Resposta | Record<string, Resposta>
  /** Faz a leitura dos travados LANÇAR (rede caindo), em vez de devolver { error }. */
  lancarNosTravados?: Error
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
      if (nome === 'alerta_travados') {
        if (c.lancarNosTravados) throw c.lancarNosTravados
        const t = c.travados ?? { data: [], ...OK }
        if ('data' in t) return t
        // por regra: a chamada não carrega o id, então o cenário identifica pelo posto pedido
        const id = (args.p_postos as string[]).join('|')
        return (t as Record<string, Resposta>)[id] ?? { data: [], ...OK }
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
  it('sem regra de parado: p_parados vazio e os travados nem são lidos', async () => {
    const m = montar({})
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(m.rpcs.some((r) => r.nome === 'alerta_travados')).toBe(false)
  })

  it('uma regra com um posto travado: UM item (o relatório), posto da ocorrência = o 1º posto da regra', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      travados: { data: [grupo({ posto: 'Embalagem' })], ...OK },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({
      r1: [
        {
          pmo: 'TODAS', op: '—', posto: 'Teste', mais_antiga_min: 300, expediente: true,
          itens: [{
            pmo: 'PRT797', op: '8563', mais_antiga_min: 300,
            itens: [{ tipo: 'posto', codigo: 'Embalagem', pecas: 4, minutos: 300 }],
          }],
        },
      ],
    })
  })

  it('várias OPs e postos viram UM único item da regra, com as OPs dentro (a mais antiga primeiro)', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      travados: {
        data: [
          grupo({ op: '8563', posto: 'Teste', em: HA_5H }),
          grupo({ op: '8564', posto: 'Embalagem', pecas: 2, em: '2026-10-28T12:00:00Z' }),
          grupo({ op: '8563', posto: 'Embalagem', pecas: 1, em: HA_5H }),
        ],
        ...OK,
      },
    })
    await m.avaliar()
    const r = m.parados().r1 as { pmo: string; op: string; itens: { op: string; itens: unknown[] }[] }[]
    expect(r).toHaveLength(1)
    expect(r[0]).toMatchObject({ pmo: 'TODAS', op: '—' })
    expect(r[0]!.itens.map((o) => o.op).sort()).toEqual(['8563', '8564'])
    expect(r[0]!.itens.find((o) => o.op === '8563')!.itens).toHaveLength(2)
  })

  it('manda ao banco o corte em horas de expediente e as opções da regra', async () => {
    const m = montar({
      regras: { data: [regra({ pmos: [' PRT797 '], so_ops_ativas: false, incluir_manutencao: false })], ...OK },
    })
    await m.avaliar()
    const rpc = m.rpcs.find((r) => r.nome === 'alerta_travados')!
    expect(rpc.args).toMatchObject({
      p_postos: ['Teste', 'Embalagem'], p_pmos: ['PRT797'], p_so_ativas: false, p_incluir_manutencao: false,
    })
    // 2 h de expediente antes de quinta 17:00: o turno acaba 17:30, então o corte é 15:00 SP (18:00Z)
    expect(rpc.args.p_corte).toBe('2026-10-29T18:00:00.000Z')
  })

  it('regra sem turno: relógio corrido, o corte é agora menos o limite, e expediente falso', async () => {
    const m = montar({
      regras: { data: [regra({ limite_horas: 168 })], ...OK },
      turnos: { data: [], ...OK },
      travados: { data: [grupo({ em: '2026-10-21T20:00:00Z' })], ...OK },
    })
    await m.avaliar()
    const rpc = m.rpcs.find((r) => r.nome === 'alerta_travados')!
    expect(rpc.args.p_corte).toBe('2026-10-22T20:00:00.000Z')
    const g = m.parados().r1 as { mais_antiga_min: number; expediente: boolean }[]
    expect(g[0]!.mais_antiga_min).toBe(8 * 24 * 60)
    expect(g[0]!.expediente).toBe(false)
  })

  it('nada travado: a chave VEM, com array vazio (é o que normaliza)', async () => {
    const m = montar({ regras: { data: [regra()], ...OK } })
    await m.avaliar()
    expect(m.parados()).toEqual({ r1: [] })
  })

  it('erro ao ler os travados: SEM a chave dessa regra, e a rodada segue com log', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      travados: { data: null, error: { message: 'boom' } },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(m.rpcs.some((r) => r.nome === 'alerta_avaliar')).toBe(true)
    expect(console.error).toHaveBeenCalled()
  })

  it('erro numa regra não tira a chave da outra', async () => {
    const m = montar({
      regras: { data: [regra({ postos: ['A'] }), regra({ id: 'r2', postos: ['B'] })], ...OK },
      travados: { A: { data: null, error: { message: 'boom' } }, B: { data: [grupo({ posto: 'B' })], ...OK } },
    })
    await m.avaliar()
    expect(Object.keys(m.parados())).toEqual(['r2'])
  })

  it('erro ao ler os turnos: SEM a chave', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      turnos: { data: null, error: { message: 'boom' } },
      travados: { data: [grupo()], ...OK },
    })
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(console.error).toHaveBeenCalled()
  })

  it('duas regras com limites diferentes: cada uma o seu mapa', async () => {
    const m = montar({
      regras: { data: [regra({ postos: ['A'] }), regra({ id: 'r2', postos: ['B'], limite_horas: 6 })], ...OK },
      turnos: { data: [TURNO, { ...TURNO, regra_id: 'r2' }], ...OK },
      travados: { A: { data: [grupo({ posto: 'A' })], ...OK }, B: { data: [], ...OK } },
    })
    await m.avaliar()
    const p = m.parados()
    expect(p.r1).toHaveLength(1)
    expect(p.r2).toEqual([])
    expect(m.rpcs.filter((r) => r.nome === 'alerta_travados')).toHaveLength(2)
  })

  it('reprovadas viram item de conserto', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      travados: { data: [grupo({ reprovada: true })], ...OK },
    })
    await m.avaliar()
    const g = m.parados().r1 as { itens: { itens: { tipo: string }[] }[] }[]
    expect(g[0]!.itens[0]!.itens[0]!.tipo).toBe('conserto')
  })
})

describe('avaliar — só dias úteis (seg a sex, calendário de São Paulo)', () => {
  it('sábado: a regra é PULADA (sem chave, nada abre nem lembra nem normaliza) e nada é lido', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      travados: { data: [grupo()], ...OK },
    })
    vi.setSystemTime(new Date('2026-10-31T15:00:00Z'))
    await m.avaliar()
    expect(m.parados()).toEqual({})
    expect(m.rpcs.some((r) => r.nome === 'alerta_travados')).toBe(false)
  })

  it('sexta às 22:30 (já sábado em UTC) ainda é dia útil', async () => {
    const m = montar({ regras: { data: [regra()], ...OK } })
    vi.setSystemTime(new Date('2026-10-31T01:30:00Z')) // sexta 30/10, 22:30 SP
    await m.avaliar()
    expect(m.parados()).toEqual({ r1: [] })
  })
})

describe('avaliar — o parado nunca derruba a rodada dos outros tipos', () => {
  it('exceção inesperada ao ler os travados: avaliar() ainda chama alerta_avaliar sem a chave', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      lancarNosTravados: new Error('fetch failed'),
    })
    await m.avaliar()
    const chamada = m.rpcs.find((r) => r.nome === 'alerta_avaliar')!
    expect(chamada.args.p_parados).toEqual({})
    // os outros mapas continuam no envio
    expect(chamada.args).toHaveProperty('p_blocos')
    expect(chamada.args).toHaveProperty('p_resumos')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('[alertas] paradosDaRodada falhou: fetch failed'))
  })

  it('linha de travados com pmo nulo não lança: é descartada e a rodada segue', async () => {
    const m = montar({
      regras: { data: [regra()], ...OK },
      travados: { data: [grupo({ pmo: null, op: 'RUIM' }), grupo({ op: 'BOA' })], ...OK },
    })
    await m.avaliar()
    const g = m.parados().r1 as { itens: { op: string }[] }[]
    expect(g[0]!.itens.map((o) => o.op)).toEqual(['BOA'])
  })

  it('elemento nulo em pmos da regra não lança', async () => {
    const m = montar({
      regras: { data: [regra({ pmos: [null, 'PRT797'] })], ...OK },
      travados: { data: [grupo()], ...OK },
    })
    await m.avaliar()
    expect(m.parados().r1).toHaveLength(1)
    expect(m.rpcs.find((r) => r.nome === 'alerta_travados')!.args.p_pmos).toEqual(['', 'PRT797'])
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
      travados: { data: [grupo()], ...OK },
    })
    await m.avaliar()
    const p = m.parados()
    expect(Object.keys(p)).toEqual(['boa'])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('regra ruim: limite_horas ilegível'))
  })
})
