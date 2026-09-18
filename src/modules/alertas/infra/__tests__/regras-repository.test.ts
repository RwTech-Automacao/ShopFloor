import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegraValida } from '../../domain/regra'

vi.mock('server-only', () => ({}))

interface Chamada {
  tabela: string
  update?: Record<string, unknown>
  filtros: [string, unknown][]
  select?: string
}

/**
 * Supabase de mentira para `.from(...).update(...).eq(...)[.is(...)].select('id')`. `linhas`
 * controla quantas linhas o update "afetou" (0 simula update que não bateu em nada — RLS ou
 * regra já excluída).
 */
function sbFalso(linhas: number) {
  const chamadas: Chamada[] = []
  function construtor(tabela: string) {
    const c: Chamada = { tabela, filtros: [] }
    chamadas.push(c)
    const q = {
      update(v: Record<string, unknown>) {
        c.update = v
        return q
      },
      eq(col: string, v: unknown) {
        c.filtros.push([col, v])
        return q
      },
      is(col: string, v: unknown) {
        c.filtros.push([col, v])
        return q
      },
      select(cols: string) {
        c.select = cols
        return q
      },
      then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
        const resultado = { data: Array.from({ length: linhas }, (_, i) => ({ id: `x${i}` })), error: null }
        return Promise.resolve(resultado).then(ok, erro)
      },
    }
    return q
  }
  const sb = { from: construtor } as unknown as SupabaseClient
  return { sb, chamadas }
}

function sbComErro(mensagem: string) {
  function construtor(tabela: string) {
    const q = {
      update() {
        return q
      },
      eq() {
        return q
      },
      is() {
        return q
      },
      select() {
        return q
      },
      then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
        return Promise.resolve({ data: null, error: { message: mensagem } }).then(ok, erro)
      },
    }
    void tabela
    return q
  }
  return { from: construtor } as unknown as SupabaseClient
}

const REGRA: RegraValida = {
  tipo: 'aprovacao',
  nome: 'Teste',
  postos: ['P1'],
  taxaMinima: 90,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 20,
  limiteTempoSeg: null,
  limiteOcorrencias: null,
  pausaMaxMin: null,
  lembreteMin: null,
  canais: ['telegram'],
  destinatarios: ['u1'],
  pmos: [],
  ativa: true,
}

describe('atualizarRegra / definirRegraAtiva / excluirRegra — regra excluída', () => {
  it('atualizarRegra: 0 linhas volta erro amigável (não lança, não engana)', async () => {
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sbFalso(0).sb }))
    const { atualizarRegra } = await import('../regras-repository')
    const r = await atualizarRegra('id1', REGRA)
    expect(r).toEqual({ ok: false, erro: 'Essa regra foi excluída.' })
    vi.doUnmock('@/shared/lib/supabase/server')
    vi.resetModules()
  })

  it('atualizarRegra: 1 linha afetada é sucesso', async () => {
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sbFalso(1).sb }))
    const { atualizarRegra } = await import('../regras-repository')
    const r = await atualizarRegra('id1', REGRA)
    expect(r).toEqual({ ok: true })
    vi.doUnmock('@/shared/lib/supabase/server')
    vi.resetModules()
  })

  it('definirRegraAtiva: 0 linhas volta erro amigável', async () => {
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sbFalso(0).sb }))
    const { definirRegraAtiva } = await import('../regras-repository')
    const r = await definirRegraAtiva('id1', true)
    expect(r).toEqual({ ok: false, erro: 'Essa regra foi excluída.' })
    vi.doUnmock('@/shared/lib/supabase/server')
    vi.resetModules()
  })

  it('excluirRegra: 0 linhas (já excluída) agora volta erro em vez de "sucesso" silencioso', async () => {
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sbFalso(0).sb }))
    const { excluirRegra } = await import('../regras-repository')
    const r = await excluirRegra('id1')
    expect(r).toEqual({ ok: false, erro: 'Essa regra foi excluída.' })
    vi.doUnmock('@/shared/lib/supabase/server')
    vi.resetModules()
  })

  it('excluirRegra: 1 linha afetada é sucesso', async () => {
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sbFalso(1).sb }))
    const { excluirRegra } = await import('../regras-repository')
    const r = await excluirRegra('id1')
    expect(r).toEqual({ ok: true })
    vi.doUnmock('@/shared/lib/supabase/server')
    vi.resetModules()
  })

  it('erro de banco (ex.: 42501) continua traduzido antes de olhar as linhas', async () => {
    vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sbComErro('permission denied') }))
    const { atualizarRegra } = await import('../regras-repository')
    const r = await atualizarRegra('id1', REGRA)
    expect(r.ok).toBe(false)
    vi.doUnmock('@/shared/lib/supabase/server')
    vi.resetModules()
  })
})
