import { describe, expect, it, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioServico } from '../repositorio-servico'

/**
 * O CRON lendo a hora do resumo como o banco entrega.
 *
 * Visto em produção em 09/10/2026, no dia em que o resumo diário subiu: regra ativa, no horário,
 * com responsável e com canal — e nada saiu. `resumo_enviado_em` ficou nulo.
 *
 * `alerta_regras.hora_resumo` é `time`, e o PostgREST entrega 'HH:MM:SS'. O lado da TELA já cortava
 * os segundos (e tinha teste para isso); o lado do CRON passava o valor cru para `lerHhMm`, que é
 * ancorado em 'HH:MM' e devolvia null. A regra ficava fora da lista de devidas, em silêncio.
 *
 * Por isso este teste alimenta o mock com o formato do BANCO, não com o da tela — era exatamente
 * essa diferença que nenhum teste cobria no caminho do cron.
 */

interface Chamada { tabela: string; colunas?: string }

function sbFake(porChamada: (c: Chamada) => { data: unknown; error: null }) {
  const rpcs: { nome: string; args: Record<string, unknown> }[] = []
  function from(tabela: string) {
    const c: Chamada = { tabela }
    const q = {
      select(colunas?: string) { c.colunas = colunas; return q },
      eq() { return q }, is() { return q }, in() { return q }, order() { return q },
      then(ok: (v: unknown) => unknown, ruim?: (e: unknown) => unknown) {
        return Promise.resolve(porChamada(c)).then(ok, ruim)
      },
    }
    return q
  }
  const sb = {
    from,
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args })
      return { data: { ocupado: false }, error: null }
    },
  } as unknown as SupabaseClient
  return { sb, rpcs }
}

/** Uma regra de resumo às 12:45 e um turno 07:00–12:00, nos formatos que o PostgREST devolve. */
function sbComResumo(horaResumo: unknown, enviadoEm: string | null = null) {
  return sbFake((c) => {
    if (c.tabela === 'alerta_regras' && c.colunas?.includes('hora_resumo')) {
      return { data: [{ id: 'r1', hora_resumo: horaResumo, resumo_enviado_em: enviadoEm }], error: null }
    }
    if (c.tabela === 'alerta_regra_intervalos') {
      return { data: [{ regra_id: 'r1', inicio: '07:00:00', fim: '12:00:00' }], error: null }
    }
    return { data: [], error: null }
  })
}

/** 09/10/2026, 12:50 em São Paulo (UTC-3) — cinco minutos depois da hora configurada. */
const AS_12_50 = new Date('2026-10-09T15:50:00.000Z')

afterEach(() => vi.useRealTimers())

describe('o cron entende a hora do resumo como o banco a entrega', () => {
  it("'12:45:00' (o que o PostgREST manda de uma coluna time) entra na rodada", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AS_12_50)
    const { sb, rpcs } = sbComResumo('12:45:00')

    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()

    const resumos = rpcs[0]!.args.p_resumos as Record<string, { dia: string; faixas: unknown[] }>
    expect(Object.keys(resumos)).toEqual(['r1'])
    expect(resumos.r1!.dia).toBe('2026-10-09')
    expect(resumos.r1!.faixas).toHaveLength(1)
  })

  it("'12:45' (a forma curta) continua funcionando", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AS_12_50)
    const { sb, rpcs } = sbComResumo('12:45')

    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()

    expect(Object.keys(rpcs[0]!.args.p_resumos as object)).toEqual(['r1'])
  })

  // As duas asserções de contraste: sem elas, um `p_resumos` que incluísse TUDO passaria nos testes
  // acima e ninguém notaria.
  it('antes da hora, a regra NÃO entra', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-09T15:40:00.000Z')) // 12:40 em São Paulo
    const { sb, rpcs } = sbComResumo('12:45:00')

    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()

    expect(rpcs[0]!.args.p_resumos).toEqual({})
  })

  it('já enviado hoje, a regra NÃO entra de novo', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AS_12_50)
    const { sb, rpcs } = sbComResumo('12:45:00', '2026-10-09')

    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()

    expect(rpcs[0]!.args.p_resumos).toEqual({})
  })

  it('hora ilegível: a regra fica de fora e o motivo vai para o log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(AS_12_50)
    const { sb, rpcs } = sbComResumo('meio-dia')

    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()

    expect(rpcs[0]!.args.p_resumos).toEqual({})
    expect(erro.mock.calls.length).toBeGreaterThan(0)
    erro.mockRestore()
  })
})
