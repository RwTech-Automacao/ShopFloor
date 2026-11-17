import { describe, expect, it, vi } from 'vitest'
import { ABAS_PADRAO, PLANILHA_PADRAO, baixarAba, configPlanilha, urlDaAba } from '../planilha-google'

describe('configPlanilha', () => {
  it('sem variável: a planilha "Peças em garantia" e as 3 abas, na ordem de prioridade', () => {
    expect(configPlanilha({})).toEqual({ planilhaId: PLANILHA_PADRAO, abas: ABAS_PADRAO })
    expect(ABAS_PADRAO.map((a) => a.gid)).toEqual(['2133071592', '1388582578', '1801872756'])
  })

  it('SAT_PLANILHA_ID e SAT_PLANILHA_GIDS (gid ou gid:nome)', () => {
    expect(configPlanilha({ SAT_PLANILHA_ID: ' abc_DEF-1 ', SAT_PLANILHA_GIDS: '11:Aba Um, 22' })).toEqual({
      planilhaId: 'abc_DEF-1',
      abas: [{ gid: '11', nome: 'Aba Um' }, { gid: '22', nome: 'aba 22' }],
    })
    // gid conhecido sem nome usa o nome padrão
    expect(configPlanilha({ SAT_PLANILHA_GIDS: '1388582578' }).abas).toEqual([{ gid: '1388582578', nome: 'Garantia 2025' }])
  })

  it('valores com cara de injeção na URL são recusados', () => {
    expect(() => configPlanilha({ SAT_PLANILHA_ID: '../x?y' })).toThrow()
    expect(() => configPlanilha({ SAT_PLANILHA_GIDS: '12&a=b' })).toThrow()
  })
})

describe('baixarAba', () => {
  it('pede o export CSV da aba', async () => {
    const f = vi.fn(async () => new Response('a,b\n1,2', { status: 200, headers: { 'content-type': 'text/csv' } }))
    expect(await baixarAba('ID', '5', f as unknown as typeof fetch)).toBe('a,b\n1,2')
    expect(f).toHaveBeenCalledWith(urlDaAba('ID', '5'), expect.anything())
    expect(urlDaAba('ID', '5')).toBe('https://docs.google.com/spreadsheets/d/ID/export?format=csv&gid=5')
  })

  it('HTTP de erro ou página HTML (planilha fechada pede login) falham', async () => {
    const erro = vi.fn(async () => new Response('x', { status: 404 }))
    await expect(baixarAba('ID', '5', erro as unknown as typeof fetch)).rejects.toThrow(/404/)
    const html = vi.fn(async () => new Response('<!DOCTYPE html><html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(baixarAba('ID', '5', html as unknown as typeof fetch)).rejects.toThrow(/pública/)
  })
})
