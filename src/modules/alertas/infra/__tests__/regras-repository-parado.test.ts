import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegraValida } from '../../domain/regra'

vi.mock('server-only', () => ({}))

type Resposta = { data: unknown; error: { code?: string; message: string } | null }

interface Chamada {
  tabela: string
  op: '' | 'select' | 'insert' | 'update' | 'delete'
  valores?: unknown
  filtros: [string, unknown][]
}

/** Supabase de mentira (mesmo jeito de intervalos-repo.test.ts): grava cada operação por tabela. */
function sbFake(resposta: (c: Chamada) => Resposta) {
  const chamadas: Chamada[] = []
  function from(tabela: string) {
    const c: Chamada = { tabela, op: '', filtros: [] }
    chamadas.push(c)
    const q = {
      select() {
        if (c.op === '') c.op = 'select'
        return q
      },
      insert(v: unknown) {
        c.op = 'insert'
        c.valores = v
        return q
      },
      update(v: unknown) {
        c.op = 'update'
        c.valores = v
        return q
      },
      delete() {
        c.op = 'delete'
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
      in(col: string, v: unknown) {
        c.filtros.push([col, v])
        return q
      },
      order() {
        return q
      },
      single() {
        return q
      },
      then(ok: (v: unknown) => unknown, ruim?: (e: unknown) => unknown) {
        return Promise.resolve(resposta(c)).then(ok, ruim)
      },
    }
    return q
  }
  return { sb: { from } as unknown as SupabaseClient, chamadas }
}

const SEM_ERRO = { error: null } as const

afterEach(() => {
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

async function repo(sb: SupabaseClient) {
  vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb }))
  return import('../regras-repository')
}

const PARADO: RegraValida = {
  modulo: 'shopfloor',
  tipo: 'parado',
  nome: 'Parado no Almoxarifado',
  postos: ['Almoxarifado'],
  taxaMinima: null,
  janelaTipo: 'op',
  janelaValor: null,
  minimoBipes: null,
  limiteTempoSeg: null,
  limiteOcorrencias: null,
  pausaMaxMin: null,
  lembreteMin: null,
  horaResumo: null,
  limiteHoras: 3,
  intervalos: [
    { inicio: '07:00', fim: '12:00' },
    { inicio: '13:30', fim: '17:30' },
  ],
  canais: ['telegram'],
  destinatarios: ['u1'],
  avisarPessoas: true,
  avisarCanal: false,
  pmos: [],
  ativa: true,
}

function linhaParado(id: string): Record<string, unknown> {
  return {
    id,
    tipo: 'parado',
    nome: id,
    postos: ['Almoxarifado'],
    taxa_minima: null,
    janela_tipo: 'op',
    janela_valor: null,
    minimo_bipes: null,
    limite_tempo_seg: null,
    limite_ocorrencias: null,
    pausa_max_min: null,
    limite_horas: 3,
    pmos: null,
    lembrete_min: null,
    canais: ['telegram'],
    destinatarios: ['u1'],
    avisar_pessoas: true,
    avisar_canal: false,
    ativa: true,
    atualizado_em: '2026-10-29T12:00:00Z',
  }
}

describe('inserirRegra — parado', () => {
  it('manda TODA coluna, com null explícito nas dos outros tipos (minimo_bipes tem default 20)', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras' ? { data: { id: 'nova' }, ...SEM_ERRO } : { data: null, ...SEM_ERRO },
    )
    const { inserirRegra } = await repo(sb)
    expect(await inserirRegra(PARADO)).toEqual({ ok: true, id: 'nova' })
    expect(chamadas[0]!.valores).toEqual({
      nome: 'Parado no Almoxarifado',
      postos: ['Almoxarifado'],
      taxa_minima: null,
      janela_tipo: 'op',
      janela_valor: null,
      minimo_bipes: null,
      limite_tempo_seg: null,
      limite_ocorrencias: null,
      pausa_max_min: null,
      limite_horas: 3,
      pmos: [],
      lembrete_min: null,
      hora_resumo: null,
      canais: ['telegram'],
      destinatarios: ['u1'],
      avisar_pessoas: true,
      avisar_canal: false,
      ativa: true,
      tipo: 'parado',
      modulo: 'shopfloor',
    })
  })

  it('grava os turnos também para o tipo parado (janela op)', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras' ? { data: { id: 'nova' }, ...SEM_ERRO } : { data: null, ...SEM_ERRO },
    )
    const { inserirRegra } = await repo(sb)
    await inserirRegra(PARADO)
    expect(chamadas.map((c) => [c.tabela, c.op])).toEqual([
      ['alerta_regras', 'insert'],
      ['alerta_regra_intervalos', 'insert'],
    ])
    expect(chamadas[1]!.valores).toEqual([
      { regra_id: 'nova', inicio: '07:00', fim: '12:00' },
      { regra_id: 'nova', inicio: '13:30', fim: '17:30' },
    ])
  })

  it('sem turno (relógio corrido) não insere intervalo nenhum', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: { id: 'nova' }, ...SEM_ERRO }))
    const { inserirRegra } = await repo(sb)
    await inserirRegra({ ...PARADO, intervalos: [] })
    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras'])
  })
})

describe('inserirRegra — outro tipo', () => {
  it('não manda limite_horas no INSERT (a 0167 sempre vai ANTES do app: a leitura das regras já pede a coluna)', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: { id: 'nova' }, ...SEM_ERRO }))
    const { inserirRegra } = await repo(sb)
    await inserirRegra({ ...PARADO, tipo: 'aprovacao', limiteHoras: null, janelaTipo: 'tempo', janelaValor: 60, intervalos: [] })
    expect(chamadas[0]!.valores).not.toHaveProperty('limite_horas')
  })
})

describe('atualizarRegra — parado', () => {
  it('apaga os turnos e insere os novos; limite_horas vai no update', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras' ? { data: [{ id: 'r1' }], ...SEM_ERRO } : { data: null, ...SEM_ERRO },
    )
    const { atualizarRegra } = await repo(sb)
    const novo = { ...PARADO, limiteHoras: 5, intervalos: [{ inicio: '08:00', fim: '12:00' }] }
    expect(await atualizarRegra('r1', novo)).toEqual({ ok: true })
    expect(chamadas.map((c) => [c.tabela, c.op])).toEqual([
      ['alerta_regras', 'update'],
      ['alerta_regra_intervalos', 'delete'],
      ['alerta_regra_intervalos', 'insert'],
    ])
    expect((chamadas[0]!.valores as Record<string, unknown>).limite_horas).toBe(5)
    expect(chamadas[1]!.filtros).toEqual([['regra_id', 'r1']])
    expect(chamadas[2]!.valores).toEqual([{ regra_id: 'r1', inicio: '08:00', fim: '12:00' }])
  })
})

describe('listarRegras — parado', () => {
  it('lê limite_horas como número e os turnos (consulta única, mesmo com janela op)', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: [linhaParado('r1')], ...SEM_ERRO }
        : { data: [{ regra_id: 'r1', inicio: '07:00:00', fim: '12:00:00' }], ...SEM_ERRO },
    )
    const { listarRegras } = await repo(sb)
    const [r] = await listarRegras('shopfloor')
    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras', 'alerta_regra_intervalos'])
    expect(chamadas[1]!.filtros).toEqual([['regra_id', ['r1']]])
    expect(r!.tipo).toBe('parado')
    expect(r!.limiteHoras).toBe(3)
    expect(typeof r!.limiteHoras).toBe('number')
    expect(r!.intervalos).toEqual([{ inicio: '07:00', fim: '12:00' }])
  })

  it('regra de outro tipo lê limiteHoras como null', async () => {
    const { sb } = sbFake(() => ({
      data: [{ ...linhaParado('r2'), tipo: 'aprovacao', limite_horas: null, janela_tipo: 'tempo', janela_valor: 60 }],
      ...SEM_ERRO,
    }))
    const { listarRegras } = await repo(sb)
    const [r] = await listarRegras('shopfloor')
    expect(r!.limiteHoras).toBeNull()
  })
})
