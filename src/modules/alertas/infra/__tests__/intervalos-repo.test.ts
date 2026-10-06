import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegraValida } from '../../domain/regra'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioServico } from '../repositorio-servico'

type Resposta = { data: unknown; error: { code?: string; message: string } | null }

interface Chamada {
  tabela: string
  op: '' | 'select' | 'insert' | 'update' | 'delete'
  valores?: unknown
  colunas?: string
  ordem?: string
  filtros: [string, unknown][]
}

/**
 * Supabase de mentira no mesmo jeito dos outros testes de infra do módulo: grava cada
 * `from(tabela).<op>(...).<filtros>` e devolve o que o teste decidir POR CHAMADA — é assim que o
 * teste consegue responder uma coisa para `alerta_regras` e outra para `alerta_regra_intervalos`.
 */
function sbFake(resposta: (c: Chamada) => Resposta) {
  const chamadas: Chamada[] = []
  const rpcs: { nome: string; args: Record<string, unknown> }[] = []
  function from(tabela: string) {
    const c: Chamada = { tabela, op: '', filtros: [] }
    chamadas.push(c)
    const q = {
      // `insert(...).select('id')` não pode virar um select: a primeira operação é que manda.
      select(colunas?: string) {
        if (c.op === '') c.op = 'select'
        c.colunas = colunas
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
      order(col: string) {
        c.ordem = col
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
  const sb = {
    from,
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args })
      return { data: { ocupado: false }, error: null }
    },
  } as unknown as SupabaseClient
  return { sb, chamadas, rpcs }
}

const SEM_ERRO = { error: null } as const

afterEach(() => {
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
  vi.useRealTimers()
})

async function repoRegras(sb: SupabaseClient) {
  vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb }))
  return import('../regras-repository')
}

const TURNO: RegraValida = {
  tipo: 'aprovacao',
  nome: 'Taxa do turno',
  postos: ['Teste'],
  taxaMinima: 90,
  janelaTipo: 'intervalos',
  janelaValor: 60,
  minimoBipes: 20,
  limiteTempoSeg: null,
  limiteOcorrencias: null,
  pausaMaxMin: null,
  lembreteMin: null,
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

/** Regra de OUTRA janela: nenhum intervalo para gravar. */
const POR_TEMPO: RegraValida = { ...TURNO, janelaTipo: 'tempo', intervalos: [] }

function linhaRegra(id: string, janelaTipo = 'intervalos'): Record<string, unknown> {
  return {
    id,
    tipo: 'aprovacao',
    nome: id,
    postos: ['Teste'],
    taxa_minima: '90.00',
    janela_tipo: janelaTipo,
    janela_valor: 60,
    minimo_bipes: 20,
    limite_tempo_seg: null,
    limite_ocorrencias: null,
    pausa_max_min: null,
    pmos: null,
    lembrete_min: null,
    canais: ['telegram'],
    destinatarios: ['u1'],
    avisar_pessoas: true,
    avisar_canal: false,
    ativa: true,
    atualizado_em: '2026-10-06T12:00:00Z',
  }
}

// =============================================================================================
// LEITURA
// =============================================================================================

describe('listarRegras — os intervalos do turno', () => {
  it('lê os intervalos de TODAS as regras numa consulta SÓ (uma por regra seria N+1)', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: [linhaRegra('r1'), linhaRegra('r2'), linhaRegra('r3', 'tempo')], ...SEM_ERRO }
        : {
            data: [
              { regra_id: 'r1', inicio: '07:00:00', fim: '12:00:00' },
              { regra_id: 'r2', inicio: '07:00:00', fim: '12:00:00' },
              { regra_id: 'r2', inicio: '13:30:00', fim: '17:30:00' },
            ],
            ...SEM_ERRO,
          },
    )
    const { listarRegras } = await repoRegras(sb)
    const regras = await listarRegras()

    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras', 'alerta_regra_intervalos'])
    expect(chamadas[1]!.filtros).toEqual([['regra_id', ['r1', 'r2']]])
    expect(chamadas[1]!.ordem).toBe('inicio')

    expect(regras.map((r) => r.intervalos)).toEqual([
      [{ inicio: '07:00', fim: '12:00' }],
      [
        { inicio: '07:00', fim: '12:00' },
        { inicio: '13:30', fim: '17:30' },
      ],
      [],
    ])
  })

  it('`time` do Postgres chega HH:MM:SS; o domínio recebe HH:MM, e linha ilegível é pulada', async () => {
    const { sb } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: [linhaRegra('r1')], ...SEM_ERRO }
        : {
            data: [
              { regra_id: 'r1', inicio: '08:15:00', fim: '12:00:00.000000' },
              { regra_id: 'r1', inicio: null, fim: '17:30:00' },
            ],
            ...SEM_ERRO,
          },
    )
    const { listarRegras } = await repoRegras(sb)
    const [r1] = await listarRegras()
    expect(r1!.intervalos).toEqual([{ inicio: '08:15', fim: '12:00' }])
  })

  it('nenhuma regra de janela intervalos: a segunda consulta nem acontece', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: [linhaRegra('r1', 'tempo')], ...SEM_ERRO }))
    const { listarRegras } = await repoRegras(sb)
    await listarRegras()
    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras'])
  })

  it('erro ao ler os intervalos não devolve regra com turno vazio por engano', async () => {
    // Este é o teste que PROVA que o mock pega: trocar o `error` por null faz ele falhar.
    const { sb } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: [linhaRegra('r1')], ...SEM_ERRO }
        : { data: null, error: { message: 'permission denied for table alerta_regra_intervalos' } },
    )
    const { listarRegras } = await repoRegras(sb)
    await expect(listarRegras()).rejects.toThrow(/alerta_regra_intervalos/)
  })
})

// =============================================================================================
// GRAVAÇÃO
// =============================================================================================

describe('inserirRegra — os intervalos da regra nova', () => {
  it('insere as N linhas do turno com o regra_id da regra criada', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras' ? { data: { id: 'nova' }, ...SEM_ERRO } : { data: null, ...SEM_ERRO },
    )
    const { inserirRegra } = await repoRegras(sb)
    expect(await inserirRegra(TURNO)).toEqual({ ok: true, id: 'nova' })

    expect(chamadas.map((c) => [c.tabela, c.op])).toEqual([
      ['alerta_regras', 'insert'],
      ['alerta_regra_intervalos', 'insert'],
    ])
    expect(chamadas[1]!.valores).toEqual([
      { regra_id: 'nova', inicio: '07:00', fim: '12:00' },
      { regra_id: 'nova', inicio: '13:30', fim: '17:30' },
    ])
  })

  it('regra de OUTRA janela não insere intervalo nenhum', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: { id: 'nova' }, ...SEM_ERRO }))
    const { inserirRegra } = await repoRegras(sb)
    expect(await inserirRegra(POR_TEMPO)).toEqual({ ok: true, id: 'nova' })
    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras'])
  })

  it('falha ao gravar o turno NÃO volta como sucesso (regra sem turno não alerta nunca)', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sb } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: { id: 'nova' }, ...SEM_ERRO }
        : { data: null, error: { message: 'violates check constraint' } },
    )
    const { inserirRegra } = await repoRegras(sb)
    const r = await inserirRegra(TURNO)
    expect(r.ok).toBe(false)
    expect(String((r as { erro: string }).erro)).toMatch(/horário/i)
    erro.mockRestore()
  })
})

describe('atualizarRegra — trocar o turno é APAGAR e INSERIR', () => {
  it('apaga os intervalos da regra (pelo regra_id) antes de inserir os novos', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras' ? { data: [{ id: 'r1' }], ...SEM_ERRO } : { data: null, ...SEM_ERRO },
    )
    const { atualizarRegra } = await repoRegras(sb)
    expect(await atualizarRegra('r1', { ...TURNO, intervalos: [{ inicio: '08:00', fim: '12:00' }] })).toEqual({
      ok: true,
    })

    expect(chamadas.map((c) => [c.tabela, c.op])).toEqual([
      ['alerta_regras', 'update'],
      ['alerta_regra_intervalos', 'delete'],
      ['alerta_regra_intervalos', 'insert'],
    ])
    // O delete é o que impede a SOBRA: sem ele a regra passaria a ter 07:00–12:00 E 08:00–12:00.
    expect(chamadas[1]!.filtros).toEqual([['regra_id', 'r1']])
    expect(chamadas[2]!.valores).toEqual([{ regra_id: 'r1', inicio: '08:00', fim: '12:00' }])
  })

  it('regra que SAIU da janela intervalos: apaga a sobra e não insere nada', async () => {
    const { sb, chamadas } = sbFake((c) =>
      c.tabela === 'alerta_regras' ? { data: [{ id: 'r1' }], ...SEM_ERRO } : { data: null, ...SEM_ERRO },
    )
    const { atualizarRegra } = await repoRegras(sb)
    expect(await atualizarRegra('r1', POR_TEMPO)).toEqual({ ok: true })
    expect(chamadas.map((c) => [c.tabela, c.op])).toEqual([
      ['alerta_regras', 'update'],
      ['alerta_regra_intervalos', 'delete'],
    ])
  })

  it('regra já excluída (0 linhas no update) NÃO encosta nos intervalos', async () => {
    const { sb, chamadas } = sbFake(() => ({ data: [], ...SEM_ERRO }))
    const { atualizarRegra } = await repoRegras(sb)
    expect(await atualizarRegra('r1', TURNO)).toEqual({ ok: false, erro: 'Essa regra foi excluída.' })
    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras'])
  })

  it('falha ao trocar o turno não volta como sucesso', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sb } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: [{ id: 'r1' }], ...SEM_ERRO }
        : { data: null, error: { message: 'permission denied' } },
    )
    const { atualizarRegra } = await repoRegras(sb)
    const r = await atualizarRegra('r1', TURNO)
    expect(r.ok).toBe(false)
    erro.mockRestore()
  })
})

// =============================================================================================
// O MAPA p_blocos DA RODADA
// =============================================================================================

/** 10:30 da manhã no fuso da fábrica (São Paulo, UTC-3) — independente do TZ do processo. */
const AS_10_30 = new Date('2026-10-06T13:30:00Z')

function sbAvaliar(intervalos: unknown[], regras?: unknown[]) {
  return sbFake((c) =>
    c.tabela === 'alerta_regras'
      ? {
          data:
            regras ?? [
              { id: 'r1', janela_tipo: 'intervalos', janela_valor: 60 },
              { id: 'r2', janela_tipo: 'intervalos', janela_valor: 60 },
            ],
          ...SEM_ERRO,
        }
      : { data: intervalos, ...SEM_ERRO },
  )
}

const MANHA = { regra_id: 'r1', inicio: '07:00:00', fim: '12:00:00' }
const TARDE = { regra_id: 'r2', inicio: '13:30:00', fim: '17:30:00' }

describe('avaliar — monta o p_blocos com os blocos que FECHARAM', () => {
  it('só a regra com bloco fechado entra no mapa, com a faixa em ISO; o canal continua indo', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, rpcs, chamadas } = sbAvaliar([MANHA, TARDE])

    await criarRepositorioServico(sb, { DISCORD_CANAL_ID: 'C9' } as unknown as NodeJS.ProcessEnv).avaliar()

    expect(rpcs).toEqual([
      {
        nome: 'alerta_avaliar',
        args: {
          p_canal_discord: 'C9',
          // r2 (13:30–17:30) ainda não fechou bloco nenhum às 10:30 — fica FORA do mapa, e o banco
          // pula a regra na rodada.
          p_blocos: {
            r1: { inicio: '2026-10-06T12:00:00.000Z', fim: '2026-10-06T13:00:00.000Z' },
          },
        },
      },
    ])
    // Duas consultas no total: as regras e os intervalos de todas elas.
    expect(chamadas.map((c) => c.tabela)).toEqual(['alerta_regras', 'alerta_regra_intervalos'])
    expect(chamadas[1]!.filtros).toEqual([['regra_id', ['r1', 'r2']]])
  })

  it('a consulta pede só as regras ATIVAS, vivas e de janela intervalos', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, chamadas } = sbAvaliar([MANHA])
    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()
    expect(chamadas[0]!.filtros).toEqual([
      ['ativa', true],
      ['excluida_em', null],
      ['janela_tipo', 'intervalos'],
    ])
  })

  it('regra de OUTRA janela não entra no mapa nem se a consulta a devolver', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, rpcs } = sbAvaliar([MANHA, { ...MANHA, regra_id: 'r9' }], [
      { id: 'r1', janela_tipo: 'intervalos', janela_valor: 60 },
      { id: 'r9', janela_tipo: 'tempo', janela_valor: 60 },
    ])
    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()
    expect(Object.keys(rpcs[0]!.args.p_blocos as object)).toEqual(['r1'])
  })

  it('regra de janela intervalos SEM intervalo cadastrado fica fora do mapa — e isso vai pro log', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, rpcs } = sbAvaliar([])
    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()
    expect(rpcs[0]!.args.p_blocos).toEqual({})
    // Ela não alertaria mais; sem o log ninguém descobriria por quê.
    expect(erro.mock.calls.map((a) => a.map(String).join(' ')).join('\n')).toContain('r1')
    erro.mockRestore()
  })

  it('fora do turno (nenhum bloco fechou hoje): mapa vazio e a rodada segue', async () => {
    vi.useFakeTimers()
    // 06:30 da manhã: antes do primeiro bloco do dia.
    vi.setSystemTime(new Date('2026-10-06T09:30:00Z'))
    const { sb, rpcs } = sbAvaliar([MANHA, TARDE])
    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()
    expect(rpcs[0]!.args.p_blocos).toEqual({})
  })

  it('⚠️ janela_valor como STRING (coluna virar numeric/bigint) GRITA no log, não emudece', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, rpcs } = sbAvaliar([MANHA], [{ id: 'r1', janela_tipo: 'intervalos', janela_valor: '60' }])

    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()

    expect(rpcs[0]!.args.p_blocos).toEqual({})
    const texto = erro.mock.calls.map((a) => a.map(String).join(' ')).join('\n')
    expect(texto).toContain('r1')
    expect(texto).toMatch(/janela_valor/)
    erro.mockRestore()
  })

  it('passo quebrado (fração, zero, nulo) também vira log, não bloco inventado', async () => {
    for (const passo of [0, 1.5, null]) {
      const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
      vi.useFakeTimers()
      vi.setSystemTime(AS_10_30)
      const { sb, rpcs } = sbAvaliar([MANHA], [{ id: 'r1', janela_tipo: 'intervalos', janela_valor: passo }])
      await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()
      expect(rpcs[0]!.args.p_blocos).toEqual({})
      expect(erro.mock.calls.length).toBeGreaterThan(0)
      erro.mockRestore()
      vi.useRealTimers()
    }
  })

  it('erro ao ler as regras: log e rodada SEGUE (as outras três janelas não podem parar)', async () => {
    // O outro teste que prova que o mock pega: com `error: null` aqui, o log não sai e ele falha.
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, rpcs } = sbFake(() => ({ data: null, error: { message: 'relation does not exist' } }))

    await criarRepositorioServico(sb, { DISCORD_CANAL_ID: 'C9' } as unknown as NodeJS.ProcessEnv).avaliar()

    expect(rpcs[0]!.args).toEqual({ p_canal_discord: 'C9', p_blocos: {} })
    expect(erro.mock.calls.length).toBeGreaterThan(0)
    erro.mockRestore()
  })

  it('erro ao ler os intervalos: idem — log, mapa vazio, rodada segue', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(AS_10_30)
    const { sb, rpcs } = sbFake((c) =>
      c.tabela === 'alerta_regras'
        ? { data: [{ id: 'r1', janela_tipo: 'intervalos', janela_valor: 60 }], ...SEM_ERRO }
        : { data: null, error: { message: 'permission denied' } },
    )
    await criarRepositorioServico(sb, {} as NodeJS.ProcessEnv).avaliar()
    expect(rpcs[0]!.args.p_blocos).toEqual({})
    expect(erro.mock.calls.length).toBeGreaterThan(0)
    erro.mockRestore()
  })
})
