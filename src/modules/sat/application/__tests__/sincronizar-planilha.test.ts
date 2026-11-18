import { describe, expect, it, vi } from 'vitest'
import { sincronizarPlanilha } from '../sincronizar-planilha'
import type { OsPlanilha } from '../../domain/planilha'

// CSVs SINTÉTICOS com os cabeçalhos das abas.
const ABA_A = { gid: '1', nome: 'Garantia 2026 - Automação' }
const ABA_B = { gid: '2', nome: 'Garantia 2025' }
const CSV_A = [
  'DATA,TÉCNICO,CLIENTE,EQUIPAMENTO,NS,GARANTIA,PRIMEIRO REGISTRO,DEFEITO,QTD,CÓDIGO DA PEÇA,PEÇA,OS,SOLUÇÃO,VENDEDOR',
  '6/1/2026 09:34:05,T,C1,REP,"562-1 562-2",,,,1,P1,Fonte,100,Envio ao SAT,V',
  '7/1/2026,T,C2,REP,562-3,,,,1,P2,Tecla,101,,V',
].join('\n')
const CSV_B = [
  'lixo',
  'DATA,TÉCNICO,CLIENTE,EQUIPAMENTO,NS,GARANTIA SEM GARANTIA,PRIMEIRO REGISTRO,DEFEITO,QTD,CÓDIGO DA PEÇA,PEÇA,OS,SOLUÇÃO',
  '06/01/2025,T,C3,REP,562-4,,,,1,P3,Cabo,200,',
].join('\n')

const contagem = (n: number) => ({ os_novas: n, os_atualizadas: 0, itens_novos: n, itens_atualizados: 0 })

describe('sincronizarPlanilha', () => {
  it('lê as abas na ordem, monta as OS e grava em lotes somando as contagens', async () => {
    const lotes: OsPlanilha[][] = []
    const r = await sincronizarPlanilha([ABA_A, ABA_B], {
      baixarAba: async (a) => (a.gid === '1' ? CSV_A : CSV_B),
      gravar: async (lote) => { lotes.push(lote); return contagem(lote.length) },
    }, 2)
    expect(lotes.map((l) => l.map((o) => o.chave))).toEqual([['100', '101'], ['200']])
    expect(r).toEqual({
      abas: [{ nome: 'Garantia 2026 - Automação', linhas: 2, erro: null }, { nome: 'Garantia 2025', linhas: 1, erro: null }],
      os: 3, itens: 4, gravado: { os_novas: 3, os_atualizadas: 0, itens_novos: 3, itens_atualizados: 0 },
    })
  })

  it('uma aba que falha não impede as outras (o banco nunca apaga)', async () => {
    const gravar = vi.fn(async (lote: OsPlanilha[]) => contagem(lote.length))
    const r = await sincronizarPlanilha([ABA_A, ABA_B], {
      baixarAba: async (a) => { if (a.gid === '1') throw new Error('HTTP 500'); return CSV_B },
      gravar,
    })
    expect(r.abas[0]).toEqual({ nome: 'Garantia 2026 - Automação', linhas: 0, erro: 'HTTP 500' })
    expect(r.os).toBe(1)
    expect(gravar).toHaveBeenCalledTimes(1)
  })

  it('todas as abas falhando: erro (o cron vê a falha)', async () => {
    const gravar = vi.fn()
    await expect(sincronizarPlanilha([ABA_A], { baixarAba: async () => 'a,b', gravar }))
      .rejects.toThrow(/nenhuma aba/i)
    expect(gravar).not.toHaveBeenCalled()
  })
})
