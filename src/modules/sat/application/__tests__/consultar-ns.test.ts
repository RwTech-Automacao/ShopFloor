import { describe, expect, it, vi } from 'vitest'
import { consultarNs, formasDoBipe, type OsDoNs, type PortasConsultaNs } from '../consultar-ns'

const os = (o: Partial<OsDoNs>): OsDoNs => ({
  id: 'x', numero: '', data: null, tecnico: '', cliente: '', equipamento: '', garantia: '', primeiroRegistro: '',
  defeito: '', observacao: '', solucao: '', vendedor: '', pecas: [], emUso: false, ...o,
})

const vazio = { revendas: [], producao: [], shopfloor: [] }
const sf = (pmo: string) => ({ pmo, op: '9001', cliente: 'C', descricao: 'REP DA OP', ultimoPosto: 'Embalagem', ultimoEm: '2025-02-11' })

function portas(p: Partial<PortasConsultaNs> = {}): PortasConsultaNs {
  return {
    osPorNs: vi.fn(async () => []),
    consultarBanco: vi.fn(async () => vazio),
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
    expect(r.sugestao).toEqual({ produto: '' })
    expect(p.osPorNs).not.toHaveBeenCalled()
    expect(p.consultarBanco).not.toHaveBeenCalled()
  })

  it('OS mais recente primeiro, já escolhida a última "Envio ao SAT"', async () => {
    const p = portas({
      osPorNs: vi.fn(async () => [
        os({ id: 'a', numero: '1', data: '2026-01-01', solucao: 'Envio ao SAT', equipamento: 'BLUE' }),
        os({ id: 'b', numero: '2', data: '2026-02-01', solucao: 'Troca' }),
      ]),
    })
    const r = await consultarNs('00043005620019177', p)
    expect(p.osPorNs).toHaveBeenCalledWith({ modelo: '562', sequencia: '19177' })
    expect(r.os.map((o) => o.id)).toEqual(['b', 'a'])
    expect(r.osSugeridaId).toBe('a')
    expect(r.nadaEncontrado).toBe(false)
  })

  it('a OS sugerida pula a que já está ligada a outra entrada', async () => {
    const p = portas({
      osPorNs: vi.fn(async () => [
        os({ id: 'a', numero: '1', data: '2026-01-01', solucao: 'Envio ao SAT' }),
        os({ id: 'c', numero: '3', data: '2026-03-01', solucao: 'Troca do Relógio', emUso: true }),
      ]),
    })
    expect((await consultarNs('562-19177', p)).osSugeridaId).toBe('a')
  })

  it('produto sugerido = código da OP do ShopFloor (PMO), nunca o EQUIPAMENTO da planilha', async () => {
    const p = portas({
      osPorNs: vi.fn(async () => [os({ id: 'a', data: '2026-01-01', solucao: 'Envio ao SAT', equipamento: 'BLUE' })]),
      consultarBanco: vi.fn(async () => ({ ...vazio, shopfloor: [sf('PMOC31'), sf('PMOD99')] })),
    })
    const r = await consultarNs('562-19177', p)
    expect(p.consultarBanco).toHaveBeenCalledWith('562', '19177', ['56219177', '43005620019177', '430056219177'])
    expect(r.sugestao).toEqual({ produto: 'PMOC31' })
  })

  it('sem ShopFloor: produto em branco (mesmo com OS na planilha)', async () => {
    const p = portas({
      osPorNs: vi.fn(async () => [os({ id: 'a', data: '2026-01-01', solucao: 'Envio ao SAT', equipamento: 'BLUE' })]),
    })
    const r = await consultarNs('562-19177', p)
    expect(r.sugestao).toEqual({ produto: '' })
    expect(r).not.toHaveProperty('compels')
  })

  it('só a sequência (sem modelo): busca a planilha pela sequência e não consulta o repinmetro pelo par', async () => {
    const p = portas()
    await consultarNs('0019177', p)
    expect(p.osPorNs).toHaveBeenCalledWith({ modelo: null, sequencia: '19177' })
    expect(p.consultarBanco).toHaveBeenCalledWith(null, '19177', ['19177'])
  })
})
