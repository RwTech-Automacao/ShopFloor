import { describe, expect, it } from 'vitest'
import { filtroOpsAtivas, opDaLinhaLista, SITUACOES_ATIVAS } from '../espelho-ops'

const LINHA = {
  id: 13100, numero: 8498, status: 'Em Processo', nivel: 1, ordemProducaoMaeNumero: null, ordemProducaoPrincipalNumero: null,
  quantidade: 10, quantidadeProduzida: 4, dataDocumento: '2026-11-10T00:00:00',
  composicaoProduto: { item: { codigo: ' PMOC14 ', descricao: 'PLACA X ' } }, negociante: { codigo: 'C0123' },
}

describe('opDaLinhaLista', () => {
  it('converte a linha da lista do Compels', () => {
    expect(opDaLinhaLista(LINHA)).toEqual({
      numero: 8498, idCompels: 13100, codigo: 'PMOC14', descricao: 'PLACA X', situacao: 'Em Processo', nivel: 1,
      quantidade: 10, quantidadeProduzida: 4, maeNumero: null, principalNumero: null, cliente: 'C0123', dataDocumento: '2026-11-10',
    })
  })
  it('data em milissegundos vira AAAA-MM-DD; sem data = null', () => {
    expect(opDaLinhaLista({ ...LINHA, dataDocumento: Date.UTC(2026, 10, 9) })?.dataDocumento).toBe('2026-11-09')
    expect(opDaLinhaLista({ ...LINHA, dataDocumento: undefined })?.dataDocumento).toBeNull()
  })
  it('sem número, sem id ou sem código = null (nunca inventa)', () => {
    expect(opDaLinhaLista({ ...LINHA, numero: undefined })).toBeNull()
    expect(opDaLinhaLista({ ...LINHA, id: 'x' })).toBeNull()
    expect(opDaLinhaLista({ ...LINHA, composicaoProduto: { item: { codigo: '' } } })).toBeNull()
  })
})

describe('filtroOpsAtivas', () => {
  it('mesmo filtro da busca de OP, sem número, com as 4 situações ativas e a janela de 3 anos', () => {
    const f = filtroOpsAtivas(Date.UTC(2026, 10, 18))
    expect(f.numero).toBe('')
    expect(f.statusList).toEqual(['Aberta', 'Planejada', 'Empenhada', 'Em Processo'])
    expect(SITUACOES_ATIVAS).toEqual(['Aberta', 'Planejada', 'Empenhada', 'Em Processo'])
    expect(f.dataInicial).toBe('2023-11-19T00:00:00')
    expect(f.dataFinal).toBe('2026-11-18T00:00:00')
    expect(f.selecionarOPPor).toBe('op')
  })
})
