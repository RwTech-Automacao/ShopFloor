import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))

import { lerPecasParadasTela } from '../relatorio-parados-repository'

type Resposta = { data: unknown; error: { code?: string; message: string } | null }
interface Chamada { fn: string; args: unknown; range?: [number, number] }

/** Supabase de mentira só com rpc (e o .range da paginação antiga). */
function sbFake(resposta: (c: Chamada) => Resposta) {
  const chamadas: Chamada[] = []
  const sb = {
    rpc(fn: string, args: unknown) {
      const c: Chamada = { fn, args }
      chamadas.push(c)
      const p = {
        range(de: number, ate: number) {
          c.range = [de, ate]
          return Promise.resolve(resposta(c))
        },
        then(ok: (r: Resposta) => unknown, erro?: (e: unknown) => unknown) {
          return Promise.resolve(resposta(c)).then(ok, erro)
        },
      }
      return p
    },
  }
  return { sb: sb as unknown as SupabaseClient, chamadas }
}

const linha = (sn: string) => ({
  pmo: 'PMOT', op: 'A', posto: 'Teste', reprovada: false, numero_serie: sn, pecas: 1,
  em: '2026-11-18T10:00:00+00:00', finalizada: false,
})
const AGORA = new Date('2026-11-19T12:00:00Z')
const OPCOES = { horas: 24, situacao: 'ativas' as const, pmos: [], turnos: [] }

describe('lerPecasParadasTela', () => {
  it('uma chamada só (sf_pecas_paradas_json), sem paginar', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: [linha('a1'), linha('a2')], error: null }))
    const sns = await lerPecasParadasTela(OPCOES, AGORA, sb)
    expect(chamadas).toEqual([{
      fn: 'sf_pecas_paradas_json',
      args: { p_corte: '2026-11-18T12:00:00.000Z', p_situacao: 'ativas', p_pmos: null },
    }])
    expect(sns.map((s) => s.numeroSerie)).toEqual(['a1', 'a2'])
  })

  it('passa as PMOs e o corte "agora" quando não há tempo', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: [], error: null }))
    await lerPecasParadasTela({ ...OPCOES, horas: null, situacao: 'todas', pmos: ['PMOT'] }, AGORA, sb)
    expect(chamadas[0]?.args).toEqual({ p_corte: AGORA.toISOString(), p_situacao: 'todas', p_pmos: ['PMOT'] })
  })

  it('erro do banco vira exceção (sem cair na paginação)', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: null, error: { code: 'P0001', message: 'SEM_PERMISSAO' } }))
    await expect(lerPecasParadasTela(OPCOES, AGORA, sb)).rejects.toThrow('sf_pecas_paradas_json: SEM_PERMISSAO')
    expect(chamadas).toHaveLength(1)
  })

  it('sem a 0193 no banco (PGRST202): pagina a sf_pecas_paradas como antes', async () => {
    const { sb, chamadas } = sbFake((c) => {
      if (c.fn === 'sf_pecas_paradas_json') return { data: null, error: { code: 'PGRST202', message: 'não achou' } }
      const de = c.range?.[0] ?? 0
      const n = de === 0 ? 1000 : 3
      return { data: Array.from({ length: n }, (_, i) => linha(`s${de + i}`)), error: null }
    })
    const sns = await lerPecasParadasTela(OPCOES, AGORA, sb)
    expect(chamadas.map((c) => [c.fn, c.range])).toEqual([
      ['sf_pecas_paradas_json', undefined],
      ['sf_pecas_paradas', [0, 999]],
      ['sf_pecas_paradas', [1000, 1999]],
    ])
    expect(sns).toHaveLength(1003)
  })
})
