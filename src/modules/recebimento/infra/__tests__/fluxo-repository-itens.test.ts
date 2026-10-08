import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('server-only', () => ({}))

/**
 * Mapeamento da RPC `rec_fluxo_emb_itens` (snake_case) para `ItemFluxo` (camelCase). O SQL e a tela
 * têm teste; este cobre o meio. Se alguém renomear uma coluna aqui, o selo viraria `?` em tudo sem
 * nenhum erro. O caso das colunas AUSENTES é o app subir em produção antes da migração 0144.
 */
let resposta: { data: unknown; error: unknown } = { data: [], error: null }
const rpc = vi.fn(async () => resposta)

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ rpc }),
}))

const { carregarItensCaixa } = await import('../fluxo-repository')

const BASE = {
  processo_id: 'p1',
  numero: 101,
  item: 'CAPJ91',
  descricao: 'CAPACITOR',
  quantidade_pedido: '500',
  quantidade_recebida: '490',
  divergencia: '-10',
  resultado: '',
  desde: '2026-09-20T12:00:00Z',
  segundos: 86400,
}

describe('carregarItensCaixa: colunas da justificativa', () => {
  beforeEach(() => {
    rpc.mockClear()
  })

  it('converte as três colunas da RPC para os campos da tela', async () => {
    resposta = {
      data: [
        {
          ...BASE,
          divergencia_justificativa: 'Fornecedor mandou a menos.',
          divergencia_justificada_por_nome: 'Maria Souza',
          divergencia_justificada_em: '2026-10-07T15:00:00Z',
        },
      ],
      error: null,
    }
    const [item] = await carregarItensCaixa('EMB390', 'qualidade')
    expect(rpc).toHaveBeenCalledWith('rec_fluxo_emb_itens', expect.objectContaining({ p_emb: 'EMB390', p_etapa: 'qualidade' }))
    expect(item!.justificativa).toBe('Fornecedor mandou a menos.')
    expect(item!.justificadaPorNome).toBe('Maria Souza')
    expect(item!.justificadaEm).toBe('2026-10-07T15:00:00Z')
  })

  it.each([
    ['ausentes (app no ar antes da migração 0144)', {}],
    [
      'nulas',
      { divergencia_justificativa: null, divergencia_justificada_por_nome: null, divergencia_justificada_em: null },
    ],
  ])('colunas %s viram texto vazio e data nula', async (_n, extras) => {
    resposta = { data: [{ ...BASE, ...extras }], error: null }
    const [item] = await carregarItensCaixa('EMB390', 'qualidade')
    expect(item!.justificativa).toBe('')
    expect(item!.justificadaPorNome).toBe('')
    expect(item!.justificadaEm).toBeNull()
    // O resto do item continua mapeado (não é um mapa vazio que passa por acaso).
    expect(item!.processoId).toBe('p1')
    expect(item!.divergencia).toBe('-10')
  })
})
