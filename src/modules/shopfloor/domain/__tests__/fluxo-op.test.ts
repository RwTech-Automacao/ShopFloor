import { describe, it, expect } from 'vitest'
import { construirFluxo, MANUTENCAO, type FluxoAgregado } from '../fluxo-op'

const zero = (posto: string): FluxoAgregado => ({ posto, wip: 0, registros: 0, aprovadas: 0, reprovadas: 0, retestes: 0 })

describe('construirFluxo', () => {
  it('cria um nó por posto na ordem + nó de Manutenção sempre', () => {
    const { nodes } = construirFluxo(['Solda', 'Teste'], [], () => false)
    const ids = nodes.map((n) => n.id)
    expect(ids).toEqual(['Solda', 'Teste', MANUTENCAO])
    expect(nodes[0].x).toBe(0)
    expect(nodes[1].x).toBe(260)
    const manut = nodes.find((n) => n.id === MANUTENCAO)!
    expect(manut.data.ehManutencao).toBe(true)
    expect(manut.y).toBe(220)
  })

  it('encaixa os agregados no nó certo (case-insensitive) e aplica temStatus', () => {
    const agg: FluxoAgregado[] = [{ posto: 'teste', wip: 3, registros: 10, aprovadas: 7, reprovadas: 3, retestes: 2 }]
    const { nodes } = construirFluxo(['Solda', 'Teste'], agg, (p) => p === 'Teste')
    const teste = nodes.find((n) => n.id === 'Teste')!
    expect(teste.data.wip).toBe(3)
    expect(teste.data.aprovadas).toBe(7)
    expect(teste.data.temStatus).toBe(true)
    const solda = nodes.find((n) => n.id === 'Solda')!
    expect(solda.data.registros).toBe(0)
    expect(solda.data.temStatus).toBe(false)
  })

  it('leva o WIP de reprovas pro nó Manutenção', () => {
    const agg: FluxoAgregado[] = [{ ...zero(MANUTENCAO), wip: 4 }]
    const { nodes } = construirFluxo(['Teste'], agg, () => true)
    expect(nodes.find((n) => n.id === MANUTENCAO)!.data.wip).toBe(4)
  })

  it('liga a cadeia em sequência e cria aresta de reprova só onde reprovadas>0', () => {
    const agg: FluxoAgregado[] = [{ ...zero('Teste'), reprovadas: 2 }]
    const { edges } = construirFluxo(['Solda', 'Teste'], agg, () => true)
    expect(edges).toContainEqual({ id: 'f:Solda->Teste', source: 'Solda', target: 'Teste', tipo: 'fluxo' })
    expect(edges).toContainEqual({ id: 'r:Teste', source: 'Teste', target: MANUTENCAO, tipo: 'reprova' })
    expect(edges.some((e) => e.id === 'r:Solda')).toBe(false)
  })

  it('marca concluído quando passou ≥ qtd da OP (aprovadas p/ com status; registros p/ sem)', () => {
    const agg: FluxoAgregado[] = [
      { ...zero('Teste'), aprovadas: 100, registros: 130 }, // com status: usa aprovadas
      { ...zero('Embalagem'), aprovadas: 0, registros: 100 }, // sem status: usa registros
      { ...zero('Solda'), aprovadas: 40, registros: 40 }, // faltou
    ]
    const { nodes } = construirFluxo(['Solda', 'Teste', 'Embalagem'], agg, (p) => p === 'Teste', () => 'nenhum', 100)
    const de = (id: string) => nodes.find((n) => n.id === id)!.data
    expect(de('Teste').concluido).toBe(true)
    expect(de('Embalagem').concluido).toBe(true)
    expect(de('Solda').concluido).toBe(false)
    // Manutenção nunca conclui; sem qtd também não conclui
    expect(de(MANUTENCAO).concluido).toBe(false)
    const semQtd = construirFluxo(['Teste'], agg, () => true).nodes.find((n) => n.id === 'Teste')!.data
    expect(semQtd.concluido).toBe(false)
  })

  it('passa o recurso pro nó (define o ícone); Manutenção recebe recurso manutencao', () => {
    const { nodes } = construirFluxo(['Burn-in'], [], () => false, (p) => (p === 'Burn-in' ? 'burnin' : 'nenhum'))
    expect(nodes.find((n) => n.id === 'Burn-in')!.data.recurso).toBe('burnin')
    expect(nodes.find((n) => n.id === MANUTENCAO)!.data.recurso).toBe('manutencao')
  })
})
