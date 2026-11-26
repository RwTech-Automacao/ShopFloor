import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase: vi.fn() }))

import { lerComCache, VALIDADE_CACHE_MS, type ArmazemCache } from '../cache-compels'

const AGORA = Date.parse('2026-11-26T12:00:00Z')
function armazem(guardado: { dados: unknown; lidoEm: string } | null): ArmazemCache & { gravar: ReturnType<typeof vi.fn> } {
  return { ler: vi.fn(async () => guardado), gravar: vi.fn(async () => {}) }
}

describe('lerComCache', () => {
  it('dentro da validade: devolve o guardado e não chama o Compels', async () => {
    const a = armazem({ dados: { arvore: [] }, lidoEm: new Date(AGORA - VALIDADE_CACHE_MS + 60_000).toISOString() })
    const buscar = vi.fn(async () => ({ arvore: null }))
    expect(await lerComCache('estrutura:PMOC31', buscar, a, AGORA)).toEqual({ arvore: [] })
    expect(buscar).not.toHaveBeenCalled()
  })
  it('vencido ou ausente: lê do Compels e grava', async () => {
    const a = armazem({ dados: { arvore: [] }, lidoEm: new Date(AGORA - VALIDADE_CACHE_MS - 1).toISOString() })
    expect(await lerComCache('estrutura:PMOC31', async () => ({ arvore: null }), a, AGORA)).toEqual({ arvore: null })
    expect(a.gravar).toHaveBeenCalledWith('estrutura:PMOC31', { arvore: null })
    const vazio = armazem(null)
    expect(await lerComCache('pais:1', async () => [], vazio, AGORA)).toEqual([])
    expect(vazio.gravar).toHaveBeenCalledWith('pais:1', [])
  })
  it('Compels fora: vale o guardado vencido; sem guardado, o erro sobe', async () => {
    const a = armazem({ dados: [1], lidoEm: '2020-01-01T00:00:00Z' })
    expect(await lerComCache('pais:1', async () => { throw new Error('fora') }, a, AGORA)).toEqual([1])
    await expect(lerComCache('pais:1', async () => { throw new Error('fora') }, armazem(null), AGORA)).rejects.toThrow('fora')
  })
  it('gravar falhou: a leitura vale mesmo assim', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const a = armazem(null)
    a.gravar.mockRejectedValueOnce(new Error('SEM_PERMISSAO'))
    expect(await lerComCache('pais:1', async () => [2], a, AGORA)).toEqual([2])
  })

  it('guardado que não tem o formato esperado (cache é gravável por quem tem sat.manutencao) vale como ausente', async () => {
    const recente = new Date(AGORA - 60_000).toISOString()
    const a = armazem({ dados: { lixo: true }, lidoEm: recente })
    const buscar = vi.fn(async () => [{ codigo: 'X', descricao: 'Y' }])
    const ehLista = (x: unknown): x is { codigo: string; descricao: string }[] => Array.isArray(x)
    expect(await lerComCache('pais:1', buscar, a, AGORA, ehLista)).toEqual([{ codigo: 'X', descricao: 'Y' }])
    expect(buscar).toHaveBeenCalled()
    // Compels fora + guardado inválido: o erro sobe (não se usa lixo)
    await expect(lerComCache('pais:1', async () => { throw new Error('fora') }, armazem({ dados: 'lixo', lidoEm: '2020-01-01T00:00:00Z' }), AGORA, ehLista)).rejects.toThrow('fora')
  })
})
