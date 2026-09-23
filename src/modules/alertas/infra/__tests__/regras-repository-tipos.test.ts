import { afterEach, describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegraValida } from '../../domain/regra'

vi.mock('server-only', () => ({}))

afterEach(() => {
  vi.doUnmock('@/shared/lib/supabase/server')
  vi.resetModules()
})

/** Supabase de mentira para insert/update: guarda o que seria gravado. */
function sbGravacao() {
  const gravado: { insert?: Record<string, unknown>; update?: Record<string, unknown> } = {}
  const q = {
    insert(v: Record<string, unknown>) {
      gravado.insert = v
      return q
    },
    update(v: Record<string, unknown>) {
      gravado.update = v
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
    single() {
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      const data = gravado.insert ? { id: 'nova' } : [{ id: 'r1' }]
      return Promise.resolve({ data, error: null }).then(ok, erro)
    },
  }
  return { sb: { from: () => q } as unknown as SupabaseClient, gravado }
}

/** Supabase de mentira para `.from(...).select(...).is(...).order(...)` (lista de regras). */
function sbLista(linhas: unknown[]) {
  const q = {
    select() {
      return q
    },
    is() {
      return q
    },
    order() {
      return q
    },
    then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
      return Promise.resolve({ data: linhas, error: null }).then(ok, erro)
    },
  }
  return { from: () => q } as unknown as SupabaseClient
}

/** Supabase de mentira para `.rpc(nome, args)`: guarda a chamada e devolve `data`. */
function sbRpc(data: unknown) {
  const chamadas: { nome: string; args: unknown }[] = []
  const sb = {
    rpc: async (nome: string, args?: unknown) => {
      chamadas.push({ nome, args })
      return { data, error: null }
    },
  } as unknown as SupabaseClient
  return { sb, chamadas }
}

async function repositorioCom(sb: SupabaseClient) {
  vi.doMock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => sb }))
  return import('../regras-repository')
}

const TEMPO: RegraValida = {
  tipo: 'tempo',
  nome: 'Teste lento',
  postos: ['Teste'],
  taxaMinima: null,
  janelaTipo: 'tempo',
  janelaValor: 60,
  minimoBipes: 10,
  limiteTempoSeg: 120,
  limiteOcorrencias: null,
  pausaMaxMin: 30,
  lembreteMin: null,
  canais: ['telegram'],
  avisarPessoas: true,
  avisarCanal: false,
  destinatarios: ['u1'],
  pmos: ['PMOA'],
  ativa: true,
}

const DEFEITO: RegraValida = {
  ...TEMPO,
  tipo: 'defeito',
  nome: 'Defeito 3x',
  minimoBipes: null,
  limiteTempoSeg: null,
  pausaMaxMin: null,
  limiteOcorrencias: 5,
  pmos: [],
}

describe('gravar regra por tipo', () => {
  it('inserirRegra grava o tipo e os campos do tipo', async () => {
    const { sb, gravado } = sbGravacao()
    const { inserirRegra } = await repositorioCom(sb)
    expect(await inserirRegra(TEMPO)).toEqual({ ok: true, id: 'nova' })
    expect(gravado.insert).toMatchObject({
      tipo: 'tempo',
      taxa_minima: null,
      minimo_bipes: 10,
      limite_tempo_seg: 120,
      limite_ocorrencias: null,
      pausa_max_min: 30,
      pmos: ['PMOA'],
    })
  })

  it('regra de defeito manda minimo_bipes nulo EXPLÍCITO (o default 20 do banco seria recusado)', async () => {
    const { sb, gravado } = sbGravacao()
    const { inserirRegra } = await repositorioCom(sb)
    await inserirRegra(DEFEITO)
    expect(gravado.insert).toHaveProperty('minimo_bipes', null)
    expect(gravado.insert).toMatchObject({ tipo: 'defeito', limite_ocorrencias: 5 })
  })

  it('atualizarRegra não manda o tipo (o tipo não muda depois de criado)', async () => {
    const { sb, gravado } = sbGravacao()
    const { atualizarRegra } = await repositorioCom(sb)
    expect(await atualizarRegra('r1', DEFEITO)).toEqual({ ok: true })
    expect(gravado.update).not.toHaveProperty('tipo')
    expect(gravado.update).toMatchObject({ limite_ocorrencias: 5, pmos: [], minimo_bipes: null })
  })
})

describe('listarRegras', () => {
  it('lê o tipo, os campos de cada tipo e as PMOs', async () => {
    const { listarRegras } = await repositorioCom(
      sbLista([
        {
          id: 'r1',
          tipo: 'tempo',
          nome: 'Teste lento',
          postos: ['Teste'],
          taxa_minima: null,
          janela_tipo: 'op',
          janela_valor: null,
          minimo_bipes: 10,
          limite_tempo_seg: 120,
          limite_ocorrencias: null,
          pausa_max_min: 30,
          pmos: ['PMOA'],
          lembrete_min: null,
          canais: ['telegram'],
          avisarPessoas: true,
    avisarCanal: false,
    destinatarios: ['u1'],
          ativa: true,
          atualizado_em: '2026-09-18T12:00:00Z',
        },
        {
          id: 'r2',
          tipo: 'coisa-nova',
          nome: 'Antiga',
          postos: ['Teste'],
          taxa_minima: '90.00',
          janela_tipo: 'tempo',
          janela_valor: 60,
          minimo_bipes: 20,
          limite_tempo_seg: null,
          limite_ocorrencias: null,
          pausa_max_min: null,
          pmos: null,
          lembrete_min: null,
          canais: ['discord'],
          avisarPessoas: true,
    avisarCanal: false,
    destinatarios: ['u1'],
          ativa: false,
          atualizado_em: '2026-09-18T12:00:00Z',
        },
      ]),
    )
    const [tempo, antiga] = await listarRegras()
    expect(tempo).toMatchObject({
      id: 'r1',
      tipo: 'tempo',
      taxaMinima: null,
      janelaTipo: 'op',
      limiteTempoSeg: 120,
      pausaMaxMin: 30,
      pmos: ['PMOA'],
    })
    expect(antiga).toMatchObject({ tipo: 'aprovacao', taxaMinima: 90, pmos: [] })
  })
})

describe('prévia por tipo', () => {
  it('manda os parâmetros nomeados da alerta_previa nova e lê as colunas novas', async () => {
    const { sb, chamadas } = sbRpc([
      {
        posto: 'Teste',
        defeito: '2040 COMPONENTE FALTANDO',
        aprovados: 0,
        reprovados: 0,
        taxa: null,
        media_seg: '68.33',
        intervalos: 29,
        pecas: 30,
        ocorrencias: 3,
        avaliavel: true,
        pmo: null,
        op: null,
      },
    ])
    const { previaRegra } = await repositorioCom(sb)
    const r = await previaRegra({
      tipo: 'defeito',
      postos: ['Teste'],
      janelaTipo: 'tempo',
      janelaValor: 60,
      minimoBipes: null,
      pausaMaxMin: null,
      limiteOcorrencias: 3,
      pmos: ['PMOA'],
    })
    expect(chamadas).toEqual([
      {
        nome: 'alerta_previa',
        args: {
          p_tipo: 'defeito',
          p_postos: ['Teste'],
          p_janela_tipo: 'tempo',
          p_janela_valor: 60,
          p_minimo: null,
          p_pausa_max_min: null,
          p_limite_ocorrencias: 3,
          p_pmos: ['PMOA'],
        },
      },
    ])
    expect(r).toEqual({
      ok: true,
      postos: [
        {
          posto: 'Teste',
          defeito: '2040 COMPONENTE FALTANDO',
          aprovados: 0,
          reprovados: 0,
          taxa: null,
          mediaSeg: 68.33,
          intervalos: 29,
          pecas: 30,
          ocorrencias: 3,
          avaliavel: true,
          pmo: null,
          op: null,
        },
      ],
    })
  })
})

describe('listarOcorrencias', () => {
  it('lê tipo, defeito e valores; taxa nula continua nula', async () => {
    const { sb } = sbRpc([
      {
        id: 'o1',
        regra_id: 'g1',
        regra_nome: 'Defeito 3x',
        posto: 'Teste',
        pmo: null,
        op: null,
        estado: 'aberta',
        taxa_abertura: null,
        taxa_ultima: null,
        aprovados: 0,
        reprovados: 0,
        aberta_em: '2026-09-18T12:00:00Z',
        resolvida_por_nome: '',
        resolvida_em: null,
        normalizada_em: null,
        envios_ok: 2,
        envios_falha: 0,
        regra_tipo: 'defeito',
        defeito: '2040 COMPONENTE FALTANDO',
        valor_abertura: '3.00',
        valor_ultimo: '4.00',
        amostras: 4,
      },
    ])
    const { listarOcorrencias } = await repositorioCom(sb)
    const [o] = await listarOcorrencias({ de: '2026-09-18', ate: '2026-09-18', estado: '' })
    expect(o).toMatchObject({
      regraTipo: 'defeito',
      defeito: '2040 COMPONENTE FALTANDO',
      taxaAbertura: null,
      taxaUltima: null,
      valorAbertura: 3,
      valorUltimo: 4,
      amostras: 4,
    })
  })
})

describe('listarPmosAlerta', () => {
  it('um array só, sem vazio nem repetida', async () => {
    const { sb, chamadas } = sbRpc(['PMOA', 'PMOB', '', 'PMOA'])
    const { listarPmosAlerta } = await repositorioCom(sb)
    expect(await listarPmosAlerta()).toEqual(['PMOA', 'PMOB'])
    expect(chamadas[0]!.nome).toBe('alerta_pmos')
  })
  it('sem dados = lista vazia', async () => {
    const { sb } = sbRpc(null)
    const { listarPmosAlerta } = await repositorioCom(sb)
    expect(await listarPmosAlerta()).toEqual([])
  })
})
