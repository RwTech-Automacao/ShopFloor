import { describe, expect, it, vi } from 'vitest'
import { carregarTelaBaixaNf, type DependenciasTela } from '../carregar-tela'

const nota = (id: number, numero: number, emissao: string) => ({ id, numero, empresa: { id: 133 }, dataHoraEmissao: `${emissao} 10:00:00` })
const linha = (codigo: string, qtd: number) => ({ quantidade: 0, itemLote: null, itemNotaICMS: { id: codigo, quantidadeInterna: qtd, numeroItemPedidoVenda: codigo } })

function deps(p: Partial<DependenciasTela> = {}): DependenciasTela {
  return {
    compels: {
      listarNfsPendentes: vi.fn(async () => [nota(2, 91, '2026-11-20'), nota(1, 74202, '2025-07-25')]),
      itensDaNf: vi.fn(async (id: number) => ({ proprias: id === 1 ? [linha('JIG100', 1)] : [linha('JIG100', 2), linha('PMOD44', 3)], emTerceiros: [], deTerceiros: [] })),
    },
    lerFila: vi.fn(async () => ({ aguardando: [], falhas: [] })),
    saldoPa: vi.fn(async (c: string) => (c === 'PMOD44' ? 10 : 0)),
    modo: 'simular',
    ...p,
  }
}

describe('carregarTelaBaixaNf', () => {
  it('todas as pendentes (sem corte), da mais antiga para a mais nova; estoque do PA uma vez por código', async () => {
    const d = deps()
    const r = await carregarTelaBaixaNf(d)
    expect(r.compels).toBe('ok')
    expect(r.notas.map((n) => n.numero)).toEqual([74202, 91])
    expect(d.saldoPa).toHaveBeenCalledTimes(2)
    expect(r.notas[1]!.itens).toEqual([
      { codigo: 'JIG100', descricao: '', quantidade: 2, estoquePa: 0 },
      { codigo: 'PMOD44', descricao: '', quantidade: 3, estoquePa: 10 },
    ])
  })

  it('Compels fora: indisponível, com a fila mesmo assim; sem login: não configurado', async () => {
    const fora = deps({ compels: { listarNfsPendentes: async () => { throw new Error('caiu') }, itensDaNf: vi.fn() } })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await carregarTelaBaixaNf(fora)).toMatchObject({ compels: 'indisponivel', filaOk: true, notas: [] })
    expect(await carregarTelaBaixaNf(deps({ compels: null }))).toMatchObject({ compels: 'nao_configurado' })
    expect(await carregarTelaBaixaNf(deps({ lerFila: async () => { throw new Error('sem tabela') } }))).toMatchObject({ compels: 'ok', filaOk: false })
  })
})
