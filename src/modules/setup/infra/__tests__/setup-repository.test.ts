import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// Cliente falso: registra o que cada tabela pediu no select e se alguém chamou .order().
const chamadas: { tabela: string; colunas: string; ordenou: boolean }[] = []
let itensDoBanco: Record<string, unknown>[] = []

function tabelaFalsa(tabela: string) {
  const reg = { tabela, colunas: '', ordenou: false }
  chamadas.push(reg)
  const resultado = tabela === 'st_setups' ? { data: { id: 's1', pmo: 'P', op: '1', processo: 'SMT', equipamento_id: 'e', face: 'TOP', colaborador: '', estado: 'rascunho', criado_em: '2026-01-01T00:00:00Z', st_equipamentos: { linha: 'L', bloco: 'B', maquina: null }, st_setup_itens: [] }, error: null } : { data: itensDoBanco, error: null }
  const q: Record<string, unknown> = {
    select: (c: string) => { reg.colunas = c; return q },
    eq: () => q,
    order: () => { reg.ordenou = true; return q },
    maybeSingle: () => Promise.resolve(resultado),
    then: (ok: (v: unknown) => unknown) => Promise.resolve(resultado).then(ok),
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ from: tabelaFalsa }) }))

import { carregarSetup } from '../setup-repository'

const linha = (id: string, posicao: string, criado_em: string) =>
  ({ id, posicao, feeder: 'F', componente: 'C', rolo: null, colaborador: '', atualizado_em: '2026-02-01T00:00:00Z', criado_em })

beforeEach(() => { chamadas.length = 0; itensDoBanco = [] })

describe('carregarSetup', () => {
  it('o select dos itens PEDE criado_em', async () => {
    await carregarSetup('s1')
    const itens = chamadas.find((c) => c.tabela === 'st_setup_itens')!
    expect(itens.colunas.split(',')).toContain('criado_em')
  })

  it('criado_em chega mapeado em criadoEm', async () => {
    itensDoBanco = [linha('a', '1', '2026-03-05T10:00:00Z')]
    const r = await carregarSetup('s1')
    expect(r!.itens[0]?.criadoEm).toBe('2026-03-05T10:00:00Z')
  })

  it('segue por POSIÇÃO (Abastecimento e Consultas), mesmo com criado_em em outra ordem', async () => {
    itensDoBanco = [linha('c', '10', '2026-03-03T00:00:00Z'), linha('a', '1', '2026-03-01T00:00:00Z'), linha('b', '2', '2026-03-09T00:00:00Z')]
    const r = await carregarSetup('s1')
    expect(r!.itens.map((i) => i.posicao)).toEqual(['1', '2', '10'])
  })

  it('a consulta dos itens não pede ordenação ao banco', async () => {
    await carregarSetup('s1')
    expect(chamadas.find((c) => c.tabela === 'st_setup_itens')!.ordenou).toBe(false)
  })
})
