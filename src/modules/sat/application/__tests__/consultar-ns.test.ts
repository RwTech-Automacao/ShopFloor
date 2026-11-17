import { describe, expect, it, vi } from 'vitest'
import { consultarNs, formasDoBipe, type OsDoNs, type PortasConsultaNs } from '../consultar-ns'

const os = (o: Partial<OsDoNs>): OsDoNs => ({
  id: 'x', numero: '', data: null, tecnico: '', cliente: '', equipamento: '', garantia: '', primeiroRegistro: '',
  defeito: '', observacao: '', solucao: '', vendedor: '', pecas: [], ...o,
})

const vazio = { revendas: [], producao: [], shopfloor: [] }

function portas(p: Partial<PortasConsultaNs> = {}): PortasConsultaNs {
  return {
    osPorNs: vi.fn(async () => []),
    consultarBanco: vi.fn(async () => vazio),
    descricaoProduto: vi.fn(async () => null),
    ...p,
  }
}

describe('formasDoBipe', () => {
  it('as formas como o ShopFloor pode ter bipado o NS (normalizadas)', () => {
    expect(formasDoBipe({ escrito: '562-19177', modelo: '562', sequencia: '19177' }))
      .toEqual(['56219177', '43005620019177', '430056219177'])
    expect(formasDoBipe({ escrito: '00043005620019177', modelo: '562', sequencia: '19177' }))
      .toEqual(['43005620019177', '430056219177'])
    expect(formasDoBipe({ escrito: '-', modelo: null, sequencia: null })).toEqual([])
  })
})

describe('consultarNs', () => {
  it('NS ilegível: não consulta nada, é entrada manual', async () => {
    const p = portas()
    const r = await consultarNs('-', p)
    expect(r.nadaEncontrado).toBe(true)
    expect(p.osPorNs).not.toHaveBeenCalled()
    expect(p.consultarBanco).not.toHaveBeenCalled()
  })

  it('OS mais recente primeiro, já escolhida a última "Envio ao SAT"; sugere empresa/CNPJ/defeito da OS', async () => {
    const p = portas({
      osPorNs: vi.fn(async () => [
        os({ id: 'a', numero: '1', data: '2026-01-01', solucao: 'Envio ao SAT', cliente: 'Cli A - 12.345.678/0001-90', defeito: 'não liga', equipamento: 'REP X' }),
        os({ id: 'b', numero: '2', data: '2026-02-01', solucao: 'Troca', cliente: 'Cli B' }),
      ]),
    })
    const r = await consultarNs('00043005620019177', p)
    expect(p.osPorNs).toHaveBeenCalledWith({ modelo: '562', sequencia: '19177' })
    expect(r.os.map((o) => o.id)).toEqual(['b', 'a'])
    expect(r.osSugeridaId).toBe('a')
    expect(r.sugestao).toEqual({ empresa: 'Cli A', cnpj: '12.345.678/0001-90', produto: 'REP X', defeito: 'não liga' })
    expect(r.nadaEncontrado).toBe(false)
  })

  it('ShopFloor + Compels: o produto sugerido é a descrição do Compels pelo código', async () => {
    const p = portas({
      consultarBanco: vi.fn(async () => ({ ...vazio, shopfloor: [
        { pmo: 'PMOD99', op: '9001', cliente: 'C', descricao: 'REP DA OP', ultimoPosto: 'Embalagem', ultimoEm: '2025-02-11' },
      ] })),
      descricaoProduto: vi.fn(async () => 'REP FICTÍCIO DO COMPELS'),
    })
    const r = await consultarNs('562-19177', p)
    expect(p.consultarBanco).toHaveBeenCalledWith('562', '19177', ['56219177', '43005620019177', '430056219177'])
    expect(r.compels).toEqual([{ codigo: 'PMOD99', descricao: 'REP FICTÍCIO DO COMPELS' }])
    expect(r.sugestao.produto).toBe('REP FICTÍCIO DO COMPELS')
  })

  it('Compels fora do ar ou sem configuração: segue sem a descrição', async () => {
    const p = portas({
      consultarBanco: vi.fn(async () => ({ ...vazio, shopfloor: [
        { pmo: 'PMOD99', op: '9001', cliente: 'C', descricao: 'REP DA OP', ultimoPosto: 'Embalagem', ultimoEm: '2025-02-11' },
      ] })),
      descricaoProduto: vi.fn(async () => { throw new Error('fora do ar') }),
    })
    const r = await consultarNs('562-19177', p)
    expect(r.compels).toEqual([])
    expect(r.sugestao.produto).toBe('REP DA OP')
  })

  it('só a sequência (sem modelo): busca a planilha pela sequência e não consulta o repinmetro pelo par', async () => {
    const p = portas()
    await consultarNs('0019177', p)
    expect(p.osPorNs).toHaveBeenCalledWith({ modelo: null, sequencia: '19177' })
    expect(p.consultarBanco).toHaveBeenCalledWith(null, '19177', ['19177'])
  })
})
