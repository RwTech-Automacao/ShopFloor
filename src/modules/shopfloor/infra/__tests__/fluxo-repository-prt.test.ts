import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * 0196 no Fluxo: a placa de PRT com série PRÓPRIA que terminou o trecho dela está terminada para a OP — não fica
 * pendente em posto nenhum (WIP), não conta nas iniciadas nem nas finalizadas, não aparece na fila do detalhe e a
 * rota dela não tem posto atual. Supabase de mentira no molde do fluxo-repository-placas.test.ts.
 */
const MAX_ROWS = 1000
let ordem: Record<string, unknown> | null = null
let registros: Record<string, unknown>[] = []
let perfis: Record<string, { temStatus: boolean; recurso: string; exigeManutencao: boolean; gate: string }> = {}

vi.mock('../postos-repository', () => ({ mapaPostoPerfil: async () => perfis }))

function consulta(tabela: string) {
  const filtros: [string, unknown][] = []
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    select: () => q,
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
      const fonte = tabela === 'sf_registros' ? registros : []
      const filtrado = fonte.filter((r) => filtros.every(([c, v]) => r[c] === v))
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      return Promise.resolve({ data: filtrado.slice(de, fim), error: null }).then(ok, erro)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({
    from: consulta,
    rpc: async () => ({ data: [], error: null }),
  }),
}))

const { carregarFluxoOp, carregarDetalhePosto, rotaDoSn } = await import('../fluxo-repository')

const PMO = 'PMO1'
const OP = '9000'
const POSTOS = [
  { posto: 'SPI', ordem: 1 },
  { posto: 'AOI', ordem: 2 },
  { posto: 'Teste', ordem: 3 },
  { posto: 'Almoxarifado', ordem: 4 },
]

let seq = 0
function registro(posto: string, sn: string, status: string, minuto: number) {
  seq += 1
  return { pmo: PMO, op: OP, posto, numero_serie: sn, numero_serie_norm: sn, status, posto_retorno: null, data_hora: `2026-11-19T10:${String(minuto).padStart(2, '0')}:00Z`, id: seq, pecas: 1 }
}

// C1 terminou o trecho (Aprovado no AOI) · C2 reprovou no AOI · C3 no meio do trecho · C4 no AOI sem Aprovado ·
// P1 é placa da PMO, aprovada no Teste.
const MASSA = () => [
  registro('SPI', 'C1', 'Aprovado', 0), registro('AOI', 'C1', 'Aprovado', 1),
  registro('SPI', 'C2', 'Aprovado', 2), registro('AOI', 'C2', 'Reprovado', 3),
  registro('SPI', 'C3', 'Aprovado', 4),
  registro('SPI', 'C4', 'Aprovado', 5), registro('AOI', 'C4', '', 6),
  registro('Teste', 'P1', 'Aprovado', 7),
]

function comTrechos(snModo: 'proprio' | 'mesmo' | null) {
  ordem = {
    qtd: 10,
    embalagem_individual: true,
    sn_ini: '',
    sn_fim: '',
    sf_ordem_postos: POSTOS,
    sf_ordem_faixas: [],
    sf_ordem_trechos: snModo
      ? [
          { tipo: 'prt', sn_modo: snModo, posto_conclui: 'AOI' },
          { tipo: 'pmo', sn_modo: 'mesmo', posto_conclui: 'Almoxarifado' },
        ]
      : [],
  }
}

describe('Fluxo — placa de PRT com série própria que terminou o trecho (0196)', () => {
  beforeEach(() => {
    seq = 0
    perfis = {
      SPI: { temStatus: true, recurso: 'nenhum', exigeManutencao: false, gate: 'aprovado' },
      AOI: { temStatus: true, recurso: 'nenhum', exigeManutencao: false, gate: 'aprovado' },
      Teste: { temStatus: true, recurso: 'nenhum', exigeManutencao: true, gate: 'aprovado' },
      Almoxarifado: { temStatus: false, recurso: 'almoxarifado', exigeManutencao: false, gate: 'registrado' },
    }
    registros = MASSA()
  })

  const wip = (r: Awaited<ReturnType<typeof carregarFluxoOp>>, posto: string) => r.agregados.find((a) => a.posto === posto)!.wip

  it('série própria: a placa que terminou some do WIP e das iniciadas; as outras ficam como antes', async () => {
    comTrechos('proprio')
    const r = await carregarFluxoOp(PMO, OP)
    expect(wip(r, 'Teste')).toBe(1) // só C4 (no AOI sem Aprovado); C1 não
    expect(wip(r, 'AOI')).toBe(2) // C2 (reprovada no posto) + C3 (no meio do trecho)
    expect(wip(r, 'Almoxarifado')).toBe(1) // P1
    expect(r.naoIniciadas).toBe(10 - 4) // C2, C3, C4, P1 iniciadas; C1 não
    expect(r.finalizadas).toBe(0)
  })

  it('PRT de série "mesmo": nada muda (a placa segue a rota da PMO)', async () => {
    comTrechos('mesmo')
    const r = await carregarFluxoOp(PMO, OP)
    expect(wip(r, 'Teste')).toBe(2) // C1 + C4
    expect(r.naoIniciadas).toBe(10 - 5)
  })

  it('OP sem trechos: idêntica', async () => {
    comTrechos(null)
    const r = await carregarFluxoOp(PMO, OP)
    expect(wip(r, 'Teste')).toBe(2)
    expect(wip(r, 'AOI')).toBe(2)
    expect(r.naoIniciadas).toBe(10 - 5)
  })

  it('detalhe do posto: a placa que terminou não aparece na fila do posto seguinte', async () => {
    comTrechos('proprio')
    const d = await carregarDetalhePosto(PMO, OP, 'Teste')
    expect(d.agora.map((x) => x.sn)).toEqual(['C4'])
    comTrechos(null)
    const antes = await carregarDetalhePosto(PMO, OP, 'Teste')
    expect(antes.agora.map((x) => x.sn)).toEqual(['C1', 'C4'])
  })

  it('rota do SN: a placa que terminou não tem posto atual; a reprovada no fim continua no posto', async () => {
    comTrechos('proprio')
    expect((await rotaDoSn(PMO, OP, 'C1')).atual).toBeNull()
    expect((await rotaDoSn(PMO, OP, 'C2')).atual).toBe('AOI')
    comTrechos(null)
    expect((await rotaDoSn(PMO, OP, 'C1')).atual).toBe('Teste')
  })
})
