// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/modules/auth/application/get-sessao', () => ({
  getSessao: vi.fn(async () => ({ perfil: {}, nome: 'Fulano', email: 'f@x.com' })),
}))
vi.mock('@/modules/auth/domain/perfil', () => ({ podeNoModulo: vi.fn(() => true) }))
vi.mock('@/modules/logs/application/registrar-log', () => ({ registrarLog: vi.fn(async () => undefined) }))
vi.mock('../../infra/postos-repository', () => ({
  mapaPostoPerfil: vi.fn(async () => ({ Integração: { recurso: 'integracao' } })),
}))
const repo = vi.hoisted(() => ({
  buscarIntegracoesPorSn: vi.fn(async () => []),
  chamarSfIntegrar: vi.fn(),
  chamarSfCancelarIntegracao: vi.fn(),
}))
vi.mock('../../infra/integracao-repository', () => repo)
// a leitura das faixas das PRTs (0195), espiada: receita só de PMOs não pode chamá-la
const estrutura = vi.hoisted(() => ({ listarPrtsDeSeriePropria: vi.fn() }))
vi.mock('../../infra/estrutura-repository', () => estrutura)

/** Supabase de mentira para `sf_ordens`: aplica os `eq` pedidos e devolve as linhas com os embeds prontos. */
let ordens: Record<string, unknown>[] = []
function consulta() {
  const filtros: { coluna: string; valor: string }[] = []
  const filtrar = () => ordens.filter((r) => filtros.every((f) => String(r[f.coluna] ?? '') === f.valor))
  const q = {
    select: () => q,
    eq(coluna: string, valor: string) { filtros.push({ coluna, valor }); return q },
    order: () => q,
    range: () => q,
    maybeSingle: () => Promise.resolve({ data: filtrar()[0] ?? null, error: null }),
    then(ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) {
      return Promise.resolve({ data: filtrar(), error: null }).then(ok, falhou)
    },
  }
  return q
}
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from: () => consulta() }) }))

const { resolverPlacaIntegracaoAction, integrar } = await import('../integracao-actions')

/** A OP do produto com trechos: PRT410 (série própria, faixa A001–A050), PRT420 (mesma série) e a PMO. */
function opComTrechos(receita: string[]) {
  return {
    cliente: 'C', pmo: 'PMOE', op: '9100', descricao: '', qtd: 10, sn_ini: '100', sn_fim: '199', embalagem_individual: false,
    placas_por_painel: 1, status: 'ATIVA',
    sf_ordem_postos: [{ posto: 'Integração', ordem: 0 }],
    sf_ordem_componentes: receita.map((c) => ({ posto: 'Integração', pmo_componente: c })),
    sf_ordem_burnin: [],
    sf_ordem_trechos: [
      { seq: 1, codigo: 'PRT410', tipo: 'prt', sn_modo: 'proprio' },
      { seq: 2, codigo: 'PRT420', tipo: 'prt', sn_modo: 'mesmo' },
      { seq: 3, codigo: 'PMOE', tipo: 'pmo', sn_modo: 'mesmo' },
    ],
    sf_ordem_faixas: [
      { seq: 1, sn_ini: '100', sn_fim: '199', trecho_seq: 3 },
      { seq: 2, sn_ini: 'A001', sn_fim: 'A050', trecho_seq: 1 },
    ],
  }
}
const opSimples = (pmo: string, op: string, ini: string, fim: string) => ({
  cliente: 'C', pmo, op, descricao: '', qtd: 10, sn_ini: ini, sn_fim: fim, embalagem_individual: false, placas_por_painel: 1,
  status: 'ATIVA', sf_ordem_postos: [], sf_ordem_componentes: [], sf_ordem_burnin: [], sf_ordem_faixas: [{ seq: 1, sn_ini: ini, sn_fim: fim }],
})

beforeEach(() => {
  vi.clearAllMocks()
  // a OP separada da PRT410 (pmo = código da PRT) com faixa própria Z001–Z050
  ordens = [opComTrechos(['PRT410', 'PMOX']), opSimples('PMOX', '7000', 'X100', 'X199'), opSimples('PRT410', '8683', 'Z001', 'Z050')]
  estrutura.listarPrtsDeSeriePropria.mockResolvedValue([{ codigo: 'PRT410', faixas: [{ sn_ini: 'A001', sn_fim: 'A050' }] }])
})

describe('Integração por bipe com PRT da própria OP na receita (0195)', () => {
  it('a placa com SN na faixa da PRT encaixa no item da PRT, com a OP do produto', async () => {
    expect(await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', 'A010')).toEqual({ ok: true, pmo: 'PRT410', op: '9100' })
  })
  it('a PMO da receita continua encaixando como antes', async () => {
    expect(await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', 'X150')).toEqual({ ok: true, pmo: 'PMOX', op: '7000' })
  })
  it('a OP separada com o mesmo código da PRT de série própria continua valendo', async () => {
    expect(await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', 'Z010')).toEqual({ ok: true, pmo: 'PRT410', op: '8683' })
  })
  it('receita só de PMOs não lê as PRTs (nenhuma consulta nova)', async () => {
    ordens[0] = opComTrechos(['PMOX'])
    expect(await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', 'X150')).toEqual({ ok: true, pmo: 'PMOX', op: '7000' })
    expect(estrutura.listarPrtsDeSeriePropria).not.toHaveBeenCalled()
  })
  it('receita que cita a PRT de série própria lê as faixas dela', async () => {
    await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', 'A010')
    expect(estrutura.listarPrtsDeSeriePropria).toHaveBeenCalledWith('PMOE', '9100')
  })
  it('PRT com a mesma série na receita no momento do bipe: segue como PMO (só a OP separada dela encaixa)', async () => {
    ordens[0] = opComTrechos(['PRT420'])
    ordens.push(opSimples('PRT420', '8684', 'W001', 'W050'))
    expect(await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', '150'))
      .toEqual({ ok: false, erro: 'Essa placa não faz parte da receita deste produto.' })
    expect(await resolverPlacaIntegracaoAction('PMOE', '9100', 'Integração', 'W010')).toEqual({ ok: true, pmo: 'PRT420', op: '8684' })
    expect(estrutura.listarPrtsDeSeriePropria).not.toHaveBeenCalled()
  })
  it('a recusa do banco de placa que não terminou a PRT vira a mensagem em PT-BR', async () => {
    repo.chamarSfIntegrar.mockResolvedValue({ ok: false, erro: 'PLACA_PRT_INCOMPLETA', placa: 'A010', prt: 'PRT410', posto: 'Inspeção AOI TOP' })
    const r = await integrar({
      colaborador: 'Fulano', pmo: 'PMOE', op: '9100', produtoSN: '150', posto: 'Integração',
      placas: [{ pmo: 'PRT410', op: '9100', sn: 'A010' }, { pmo: 'PMOX', op: '7000', sn: 'X150' }],
    })
    expect(r).toEqual({ ok: false, erro: 'A placa A010 ainda não terminou a PRT410 (falta o posto Inspeção AOI TOP).' })
    // a placa da PRT vai para o banco com o código da PRT e a OP do produto
    expect(repo.chamarSfIntegrar.mock.calls[0]![0].p_placas).toEqual([
      { pmo: 'PRT410', op: '9100', sn: 'A010', sn_norm: 'a010' },
      { pmo: 'PMOX', op: '7000', sn: 'X150', sn_norm: 'x150' },
    ])
  })
  it('a mensagem de placa fora da receita continua a mesma', async () => {
    repo.chamarSfIntegrar.mockResolvedValue({ ok: false, erro: 'PLACA_FORA_DA_RECEITA', pmo: 'PMOY' })
    const r = await integrar({ colaborador: 'Fulano', pmo: 'PMOE', op: '9100', produtoSN: '150', posto: 'Integração', placas: [{ pmo: 'PMOY', op: '1', sn: 'Y1' }] })
    expect(r).toEqual({ ok: false, erro: 'A placa de PMO PMOY não faz parte da receita deste produto.' })
  })
})
