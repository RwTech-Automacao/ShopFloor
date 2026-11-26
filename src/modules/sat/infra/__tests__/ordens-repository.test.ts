import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: async () => ({ rpc }) }))

import { ErroDoBanco } from '../repository'
import {
  adicionarPeca, corrigirEtapa, enviarQualidade, eventoDaLinha, ordemResumoDaLinha, trocarNs,
} from '../ordens-repository'

afterEach(() => rpc.mockReset())

const AGORA = Date.parse('2026-11-26T15:00:00Z')

describe('ordemResumoDaLinha', () => {
  it('lê a linha da sat_ordens; tipo/etapa desconhecidos não passam', () => {
    expect(ordemResumoDaLinha({
      id: 'o1', numero: '0397/26', etapa: 'em_manutencao', etapa_desde: '2026-11-26T10:00:00Z', tipo: 'em_garantia',
      cliente: 'C', ns_atual: '562-1', produto: 'PMOC31', ticket_numero: '900', tecnico_nome: 'T', criado_em: '2026-11-25T10:00:00Z',
    }, AGORA)).toEqual({
      id: 'o1', numero: '0397/26', etapa: 'em_manutencao', etapaDesde: '2026-11-26T10:00:00Z', tempoNaEtapa: '5 h',
      tipo: 'em_garantia', cliente: 'C', nsAtual: '562-1', produto: 'PMOC31', ticketNumero: '900', tecnicoNome: 'T',
      criadoEm: '2026-11-25T10:00:00Z',
    })
    expect(ordemResumoDaLinha({ etapa: 'qualquer', tipo: 'x' }, AGORA)).toMatchObject({ etapa: 'recebido', tipo: null })
  })
})

describe('eventoDaLinha', () => {
  it('lê o histórico (etapas null quando não é mudança de etapa)', () => {
    expect(eventoDaLinha({ evento: 'peca', etapa_de: null, etapa_para: null, dados: { codigo: 'X' }, usuario_nome: 'U', em: 'E' }))
      .toEqual({ evento: 'peca', etapaDe: null, etapaPara: null, dados: { codigo: 'X' }, usuarioNome: 'U', em: 'E' })
  })
})

describe('gravações', () => {
  it('chamam a função da 0198 com os nomes de parâmetro certos', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    await adicionarPeca('o1', { codigo: 'PMOE74', descricao: 'Kit', quantidade: 1.5 })
    expect(rpc).toHaveBeenLastCalledWith('sat_ordem_peca_adicionar', { p_ordem: 'o1', p_codigo: 'PMOE74', p_descricao: 'Kit', p_quantidade: 1.5 })
    await trocarNs('o1', { escrito: '562-9', modelo: '562', sequencia: '9' })
    expect(rpc).toHaveBeenLastCalledWith('sat_ordem_trocar_ns', { p_ordem: 'o1', p: { ns: '562-9', modelo: '562', sequencia: '9' } })
    await corrigirEtapa('o1', 'em_manutencao', 'motivo')
    expect(rpc).toHaveBeenLastCalledWith('sat_ordem_corrigir_etapa', { p_ordem: 'o1', p_etapa: 'em_manutencao', p_motivo: 'motivo' })
  })
  it('erro do banco vira ErroDoBanco com o código', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'SEM_LAUDO' } })
    const e = await enviarQualidade('o1').catch((x) => x)
    expect(e).toBeInstanceOf(ErroDoBanco)
    expect(e.message).toBe('SEM_LAUDO')
  })
})
