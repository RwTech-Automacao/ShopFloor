import { describe, expect, it } from 'vitest'
import { filtrarNotas, montarNotaDaTela, type NotaDaTela } from '../tela'
import type { NotaPendente } from '@/modules/compels/domain/baixa-nf'

const nota: NotaPendente = {
  id: 7, numero: 80, empresaId: 133, emissao: '2026-11-18', codigoRemetente: 'C1', razaoSocialNomeRemetente: 'ACME',
  informacoesComplementares: '', clienteCodigo: 'C1', clienteNome: 'ACME', valor: 10, pedidoVenda: '2836/26', natureza: 'VENDA',
}
const semSaldo = { quantidade: 0, itemLote: null, itemNotaICMS: { id: 9, quantidadeInterna: 5, descricao: 'MÓDULO', numeroItemPedidoVenda: 'PMOD44' } }

describe('montarNotaDaTela', () => {
  it('itens com o estoque do PA, situação e posição na fila', () => {
    const n = montarNotaDaTela(nota, { proprias: [semSaldo], emTerceiros: [], deTerceiros: [] }, new Map([['PMOD44', 2]]), [3, 7])
    expect(n).toMatchObject({
      id: 7, numero: 80, pedidoVenda: '2836/26', posicaoNaFila: 2,
      itens: [{ codigo: 'PMOD44', descricao: 'MÓDULO', quantidade: 5, estoquePa: 2 }],
      situacao: { tipo: 'sem_saldo', faltas: [{ codigo: 'PMOD44', falta: 3 }] },
    })
    expect(montarNotaDaTela(nota, { proprias: [semSaldo], emTerceiros: [], deTerceiros: [] }, new Map(), []).posicaoNaFila).toBeNull()
  })
})

describe('filtrarNotas', () => {
  const base = (p: Partial<NotaDaTela>): NotaDaTela => ({
    id: 1, numero: 80, emissao: '2026-11-18', clienteCodigo: 'C1', clienteNome: 'ACME', valor: 1, pedidoVenda: '', natureza: '',
    itens: [{ codigo: 'PMOD44', descricao: 'MÓDULO', quantidade: 1, estoquePa: 1 }], situacao: { tipo: 'pode_baixar' }, posicaoNaFila: null, ...p,
  })
  const notas = [
    base({ id: 1 }),
    base({ id: 2, numero: 91, clienteNome: 'BETA', emissao: '2026-11-20', itens: [{ codigo: 'PRT446', descricao: 'PLACA', quantidade: 1, estoquePa: 0 }], situacao: { tipo: 'sem_saldo', motivo: '', faltas: [] } }),
  ]
  const vazio = { numero: '', cliente: '', item: '', de: '', ate: '', soPodeBaixar: false }
  const ids = (f: Partial<typeof vazio>) => filtrarNotas(notas, { ...vazio, ...f }).map((n) => n.id)
  it('por número, cliente (código ou nome), item (código ou descrição), período e "só as que podem baixar"', () => {
    expect(ids({})).toEqual([1, 2])
    expect(ids({ numero: '91' })).toEqual([2])
    expect(ids({ cliente: 'acm' })).toEqual([1])
    expect(ids({ item: 'placa' })).toEqual([2])
    expect(ids({ item: 'pmod' })).toEqual([1])
    expect(ids({ de: '2026-11-19' })).toEqual([2])
    expect(ids({ ate: '2026-11-18' })).toEqual([1])
    expect(ids({ soPodeBaixar: true })).toEqual([1])
  })
})
