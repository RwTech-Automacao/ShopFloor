import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
import { gravarOsDoServico, loteParaBanco } from '../os-repository'
import { montarOs } from '../../domain/planilha'

const os = montarOs([{
  aba: 'A', linha: 2, data: '2026-01-06', tecnico: 'T', cliente: 'C', equipamento: 'E', ns: '562-1', garantia: 'G',
  primeiroRegistro: 'P', defeito: 'D', observacao: 'O', quantidade: 2, codigoPeca: 'P1', peca: 'Fonte', os: '9',
  solucao: 'S', vendedor: 'V',
}])

describe('loteParaBanco', () => {
  it('usa os nomes de campo que a sat_sincronizar_planilha (0186) lê', () => {
    expect(loteParaBanco(os)).toEqual([{
      chave: '9', numero: '9', data: '2026-01-06', tecnico: 'T', cliente: 'C', equipamento: 'E', garantia: 'G',
      primeiro_registro: 'P', defeito: 'D', observacao: 'O', solucao: 'S', vendedor: 'V', aba: 'A', linha: 2,
      itens: [{ chave: '562/1|P1|2026-01-06', ns: '562-1', modelo: '562', sequencia: '1', codigo_peca: 'P1',
        peca: 'Fonte', quantidade: 2, data: '2026-01-06' }],
    }])
  })
})

describe('gravarOsDoServico', () => {
  it('chama a função do banco e devolve a contagem; erro do banco vira exceção', async () => {
    const contagem = { os_novas: 1, os_atualizadas: 0, itens_novos: 1, itens_atualizados: 0 }
    const rpc = vi.fn(async () => ({ data: contagem, error: null }))
    expect(await gravarOsDoServico({ rpc } as never)(os)).toEqual(contagem)
    expect(rpc).toHaveBeenCalledWith('sat_sincronizar_planilha', { p_os: loteParaBanco(os) })
    const falha = vi.fn(async () => ({ data: null, error: { message: 'x' } }))
    await expect(gravarOsDoServico({ rpc: falha } as never)(os)).rejects.toThrow(/x/)
  })
})
