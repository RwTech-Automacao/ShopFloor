import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))

import { cadastrarOp, ultimaOpDaPmo } from '../cadastro-op-repository'
import type { CadastroOp } from '../../domain/cadastro-op'

const C: CadastroOp = {
  modo: 'compels', pmo: 'PMOC14', op: '8498', cliente: 'LINCE', descricao: 'PLACA', qtd: 10, acp: '', embalagemIndividual: true, placasPorPainel: 2,
  trechos: [
    { seq: 1, codigo: 'PRT410', tipo: 'prt', compelsOp: '8500', descricao: '', quantidade: 10, situacao: '', snModo: 'proprio', postos: ['SPI'], faixas: [{ sn_ini: 'A1', sn_fim: 'A5' }] },
    { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compelsOp: '8498', descricao: '', quantidade: 10, situacao: '', snModo: 'mesmo', postos: ['Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1', sn_fim: '5' }] },
  ],
  componentes: [{ posto: 'Teste', pmo: 'PMOZ' }], burnin: [{ posto: 'Teste', tempo_min: 360 }],
}

describe('cadastro-op-repository', () => {
  it('cadastrarOp manda o payload da sf_cadastrar_op e devolve o id', async () => {
    rpc.mockResolvedValueOnce({ data: 'uuid-1', error: null })
    expect(await cadastrarOp(C)).toBe('uuid-1')
    expect(rpc).toHaveBeenCalledWith('sf_cadastrar_op', { p: {
      ordem: { pmo: 'PMOC14', op: '8498', cliente: 'LINCE', qtd: 10, descricao: 'PLACA', acp: '', embalagem_individual: true, placas_por_painel: 2 },
      trechos: [
        { seq: 1, codigo: 'PRT410', tipo: 'prt', compels_op: '8500', sn_modo: 'proprio', postos: ['SPI'], faixas: [{ sn_ini: 'A1', sn_fim: 'A5' }] },
        { seq: 2, codigo: 'PMOC14', tipo: 'pmo', compels_op: '8498', sn_modo: 'mesmo', postos: ['Teste', 'Almoxarifado'], faixas: [{ sn_ini: '1', sn_fim: '5' }] },
      ],
      componentes: [{ posto: 'Teste', pmo: 'PMOZ' }], burnin: [{ posto: 'Teste', tempo_min: 360 }],
    } })
  })
  it('postos vão aparados e sem os vazios (o banco grava como vier)', async () => {
    rpc.mockResolvedValueOnce({ data: 'uuid-2', error: null })
    await cadastrarOp({ ...C, trechos: [{ ...C.trechos[1]!, postos: [' Teste ', '', '  ', 'Almoxarifado'] }] })
    const p = rpc.mock.calls.at(-1)![1].p as { trechos: { postos: string[] }[] }
    expect(p.trechos[0]!.postos).toEqual(['Teste', 'Almoxarifado'])
  })
  it('erro do banco sobe com code/message', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate' } })
    await expect(cadastrarOp(C)).rejects.toMatchObject({ code: '23505' })
  })
  it('ultimaOpDaPmo converte; sem OP = null', async () => {
    rpc.mockResolvedValueOnce({ data: { op: '8476', cliente: 'LINCE', descricao: 'X', placas_por_painel: 1, embalagem_individual: false,
      postos: [{ posto: 'SPI', trecho_codigo: 'PRT410' }, { posto: 'Teste', trecho_codigo: null }], componentes: [], burnin: [] }, error: null })
    expect(await ultimaOpDaPmo('PMOC14')).toEqual({ op: '8476', cliente: 'LINCE', descricao: 'X', placasPorPainel: 1, embalagemIndividual: false,
      postos: [{ posto: 'SPI', trechoCodigo: 'PRT410' }, { posto: 'Teste', trechoCodigo: null }], componentes: [], burnin: [] })
    expect(rpc).toHaveBeenLastCalledWith('sf_ultima_op_da_pmo', { p_pmo: 'PMOC14' })
    rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await ultimaOpDaPmo('NAO')).toBeNull()
  })
})
