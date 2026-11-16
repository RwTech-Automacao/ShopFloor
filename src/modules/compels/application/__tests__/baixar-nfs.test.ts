import { describe, expect, it, vi } from 'vitest'
import { baixarNfsPendentes, configBaixaNf, type PortaBaixaNf } from '../baixar-nfs'

const nota = (id: number, numero: number, emissao: string) => ({ id, numero, empresa: { id: 133 }, dataHoraEmissao: `${emissao} 10:00:00` })
const comSaldo = {
  id: 1, quantidade: 2, unidade: 'UN', itemNotaICMS: { id: 9, quantidadeInterna: 2 },
  itemLote: { id: 5, item: { id: 7, rastreavel: false, codigo: 'PMOD44' }, itemLoteEstoque: { estoque: { codigo: 'PA' }, itemLoteEstoqueLocacao: { id: 3, saldo: 10 } } },
}
const semSaldo = { id: 2, quantidade: 0, itemNotaICMS: { id: 9, quantidadeInterna: 2 }, itemLote: null }

function porta(notas: unknown[], itens: Record<number, unknown[]>, baixar = vi.fn(async () => ({ ok: true as const, mensagem: 'ok' }))) {
  const p: PortaBaixaNf = {
    listarNfsPendentes: vi.fn(async () => notas as Record<string, unknown>[]),
    itensDaNf: vi.fn(async (id: number) => ({ proprias: itens[id] ?? [], emTerceiros: [], deTerceiros: [] })),
    travarNf: vi.fn(async () => ({ ok: true as const, mensagem: '' })),
    liberarNf: vi.fn(async () => undefined),
    baixarNf: baixar,
  }
  return p
}

const op = { desde: '2026-11-17', usuario: 'ShopFloor' }

describe('baixarNfsPendentes', () => {
  it('nunca toca nota de antes do corte (a NF 74202 nem é lida)', async () => {
    const p = porta([nota(1, 74202, '2025-07-25')], { 1: [comSaldo] })
    expect((await baixarNfsPendentes(p, { ...op, modo: 'baixar' })).notas).toEqual([])
    expect(p.itensDaNf).not.toHaveBeenCalled()
    expect(p.baixarNf).not.toHaveBeenCalled()
  })

  it('simulação diz o que faria e nunca trava nem baixa', async () => {
    const p = porta([nota(1, 80, '2026-11-18')], { 1: [comSaldo] })
    const r = await baixarNfsPendentes(p, { ...op, modo: 'simular' })
    expect(r.notas).toEqual([{ numero: 80, emissao: '2026-11-18', resultado: 'simulada', detalhe: 'baixaria 2 × PMOD44' }])
    expect(p.travarNf).not.toHaveBeenCalled()
    expect(p.baixarNf).not.toHaveBeenCalled()
  })

  it('baixa da mais antiga para a mais nova, pula a sem saldo e libera a trava', async () => {
    const p = porta([nota(2, 91, '2026-11-20'), nota(1, 90, '2026-11-18'), nota(3, 92, '2026-11-19')], { 1: [comSaldo], 2: [comSaldo], 3: [semSaldo] })
    const r = await baixarNfsPendentes(p, { ...op, modo: 'baixar' })
    expect(r.notas.map((n) => [n.numero, n.resultado])).toEqual([[90, 'baixada'], [92, 'esperando'], [91, 'baixada']])
    expect(p.liberarNf).toHaveBeenCalledTimes(2)
  })

  it('baixar recusado ou com erro: registra a falha e libera a trava mesmo assim', async () => {
    const baixar = vi.fn(async () => { throw new Error('caiu') })
    const p = porta([nota(1, 80, '2026-11-18')], { 1: [comSaldo] }, baixar as never)
    const r = await baixarNfsPendentes(p, { ...op, modo: 'baixar' })
    expect(r.notas[0]).toMatchObject({ resultado: 'falhou', detalhe: 'caiu' })
    expect(p.liberarNf).toHaveBeenCalledWith(1)
  })

  it('nota aberta por alguém no Compels: espera, sem baixar', async () => {
    const p = porta([nota(1, 80, '2026-11-18')], { 1: [comSaldo] })
    p.travarNf = vi.fn(async () => ({ ok: false as const, codigo: 'op_em_uso' as const, mensagem: 'em uso', tentarDeNovo: true }))
    const r = await baixarNfsPendentes(p, { ...op, modo: 'baixar' })
    expect(r.notas[0]!.resultado).toBe('esperando')
    expect(p.baixarNf).not.toHaveBeenCalled()
  })
})

describe('configBaixaNf', () => {
  it('desligada sem data ou sem modo; simular e baixar', () => {
    expect(configBaixaNf({})).toBeNull()
    expect(configBaixaNf({ COMPELS_BAIXA_NF: 'simular' })).toBeNull()
    expect(configBaixaNf({ COMPELS_BAIXA_NF: 'talvez', COMPELS_BAIXA_NF_DESDE: '2026-11-17' })).toBeNull()
    expect(configBaixaNf({ COMPELS_BAIXA_NF: 'simular', COMPELS_BAIXA_NF_DESDE: '2026-11-17' })).toEqual({ modo: 'simular', desde: '2026-11-17', usuario: 'ShopFloor' })
    expect(configBaixaNf({ COMPELS_BAIXA_NF: '1', COMPELS_BAIXA_NF_DESDE: '2026-11-17' })?.modo).toBe('baixar')
  })
})
