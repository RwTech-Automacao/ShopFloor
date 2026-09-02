import { describe, it, expect } from 'vitest'
import { construirFluxo, numerarPassagens, postoPendenteDePeca, formatarRelogio, MANUTENCAO, ENTRADA, SAIDA, type FluxoAgregado, type RegistroPassagem, type BipePeca } from '../fluxo-op'

const zero = (posto: string): FluxoAgregado => ({ posto, wip: 0, registros: 0, aprovadas: 0, reprovadas: 0, retestes: 0, aprovadosPrimeira: 0, reprovadosSemReteste: 0 })

describe('construirFluxo', () => {
  it('cria um nó por posto na ordem + nó de Manutenção sempre', () => {
    const { nodes } = construirFluxo(['Solda', 'Teste'], [], () => false)
    const ids = nodes.map((n) => n.id)
    expect(ids).toEqual(['Solda', 'Teste', MANUTENCAO])
    expect(nodes[0]!.x).toBe(0)
    expect(nodes[1]!.x).toBe(300)
    const manut = nodes.find((n) => n.id === MANUTENCAO)!
    expect(manut.data.ehManutencao).toBe(true)
    // Serpentina: Manutenção fica UMA linha abaixo da última linha de postos (aqui só 1 linha → y = 200).
    expect(manut.y).toBe(200)
  })

  it('serpentina: quebra em linhas alternando o sentido (6º posto volta pela direita)', () => {
    const postos = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']
    const { nodes } = construirFluxo(postos, [], () => false)
    const pos = (id: string) => nodes.find((n) => n.id === id)!
    // 1ª linha (y=0): esquerda → direita
    expect([pos('P1').x, pos('P1').y]).toEqual([0, 0])
    expect([pos('P5').x, pos('P5').y]).toEqual([1200, 0])
    // 2ª linha (y=200): volta da direita pra esquerda
    expect([pos('P6').x, pos('P6').y]).toEqual([1200, 200])
    expect([pos('P7').x, pos('P7').y]).toEqual([900, 200])
  })

  it('encaixa os agregados no nó certo (case-insensitive) e aplica temStatus', () => {
    const agg: FluxoAgregado[] = [{ posto: 'teste', wip: 3, registros: 10, aprovadas: 7, reprovadas: 3, retestes: 2, aprovadosPrimeira: 6, reprovadosSemReteste: 1 }]
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

  it('só liga na Manutenção os postos que exigem Manutenção (conserto no próprio posto não liga)', () => {
    // SPI e Inspeção reprovam mas fazem conserto no próprio posto (exigeManutencao=false);
    // Teste roteia pra Manutenção (exigeManutencao=true). Todos com reprovadas>0.
    const agg: FluxoAgregado[] = [
      { ...zero('SPI'), reprovadas: 2 },
      { ...zero('Inspeção'), reprovadas: 5 },
      { ...zero('Teste'), reprovadas: 3 },
    ]
    const { edges } = construirFluxo(
      ['SPI', 'Inspeção', 'Teste'],
      agg,
      () => true,
      () => 'nenhum',
      null,
      (p) => p === 'Teste', // só Teste exige Manutenção
    )
    expect(edges).toContainEqual({ id: 'r:Teste', source: 'Teste', target: MANUTENCAO, tipo: 'reprova' })
    expect(edges.some((e) => e.id === 'r:SPI')).toBe(false)
    expect(edges.some((e) => e.id === 'r:Inspeção')).toBe(false)
  })

  it('cria as caixas de Entrada/Saída (vinho) com contagem e as liga nas pontas', () => {
    const { nodes, edges } = construirFluxo(
      ['Solda', 'Teste'], [], () => false, () => 'nenhum', 10, () => true, 3, 5,
    )
    const entrada = nodes.find((n) => n.id === ENTRADA)!
    const saida = nodes.find((n) => n.id === SAIDA)!
    expect(entrada.data.ehEntrada).toBe(true)
    expect(entrada.data.wip).toBe(3) // não iniciadas
    expect(entrada.x).toBe(-300) // antes do 1º posto
    expect(saida.data.ehSaida).toBe(true)
    expect(saida.data.wip).toBe(5) // finalizadas
    expect(saida.x).toBe(600) // depois do último (2 postos × 300)
    expect(edges).toContainEqual({ id: `f:${ENTRADA}->Solda`, source: ENTRADA, target: 'Solda', tipo: 'fluxo' })
    expect(edges).toContainEqual({ id: `f:Teste->${SAIDA}`, source: 'Teste', target: SAIDA, tipo: 'fluxo' })
  })

  it('não cria caixas quando as contagens não são informadas (null)', () => {
    const { nodes } = construirFluxo(['Solda', 'Teste'], [], () => false)
    expect(nodes.some((n) => n.id === ENTRADA)).toBe(false)
    expect(nodes.some((n) => n.id === SAIDA)).toBe(false)
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

  it('passou usa passouDistinto (peças distintas), não o bipe-count aprovadas — corrige card 1457/1410', () => {
    // aprovadas=1457 (bipes, com reteste) mas só 1410 peças distintas passaram; qtd=1410.
    const agg: FluxoAgregado[] = [{ ...zero('Teste'), wip: 0, aprovadas: 1457, passouDistinto: 1410 }]
    const t = construirFluxo(['Teste'], agg, () => true, () => 'nenhum', 1410).nodes.find((n) => n.id === 'Teste')!.data
    expect(t.passou).toBe(1410) // distinto, não 1457
    expect(t.concluido).toBe(true) // 1410 >= 1410 e wip 0
  })

  it('NÃO marca concluído quando ainda há peças pendentes no posto (wip > 0), mesmo com passou ≥ qtd (bug de produção)', () => {
    // aprovadas conta BIPES (retestes inflam) → 105 ≥ qtd 100, mas 8 peças ainda pendentes aqui.
    const agg: FluxoAgregado[] = [{ ...zero('Teste'), wip: 8, aprovadas: 105, registros: 130 }]
    const { nodes } = construirFluxo(['Teste'], agg, () => true, () => 'nenhum', 100)
    expect(nodes.find((n) => n.id === 'Teste')!.data.concluido).toBe(false)
  })

  it('preenche passou/devemPassar (D1): passou = aprovadas p/ posto com status, registros p/ sem; devemPassar = qtd', () => {
    const agg: FluxoAgregado[] = [
      { ...zero('Teste'), aprovadas: 7, registros: 10 }, // com status: usa aprovadas
      { ...zero('Embalagem'), aprovadas: 0, registros: 4 }, // sem status: usa registros
    ]
    const { nodes } = construirFluxo(['Teste', 'Embalagem'], agg, (p) => p === 'Teste', () => 'nenhum', 100)
    const de = (id: string) => nodes.find((n) => n.id === id)!.data
    expect(de('Teste').passou).toBe(7)
    expect(de('Teste').devemPassar).toBe(100)
    expect(de('Embalagem').passou).toBe(4)
    expect(de('Embalagem').devemPassar).toBe(100)
  })

  it('devemPassar é null quando a OP não tem qtd', () => {
    const { nodes } = construirFluxo(['Teste'], [], () => true)
    expect(nodes.find((n) => n.id === 'Teste')!.data.devemPassar).toBeNull()
  })

  it('caixas de Entrada/Saída (nós sintéticos) recebem defaults que não disparam o visual novo (passou=0, devemPassar=null)', () => {
    const { nodes } = construirFluxo(['Solda'], [], () => false, () => 'nenhum', 10, () => true, 3, 5)
    const entrada = nodes.find((n) => n.id === ENTRADA)!
    const saida = nodes.find((n) => n.id === SAIDA)!
    expect(entrada.data.passou).toBe(0)
    expect(entrada.data.devemPassar).toBeNull()
    expect(saida.data.passou).toBe(0)
    expect(saida.data.devemPassar).toBeNull()
  })

  it('passa o recurso pro nó (define o ícone); Manutenção recebe recurso manutencao', () => {
    const { nodes } = construirFluxo(['Burn-in'], [], () => false, (p) => (p === 'Burn-in' ? 'burnin' : 'nenhum'))
    expect(nodes.find((n) => n.id === 'Burn-in')!.data.recurso).toBe('burnin')
    expect(nodes.find((n) => n.id === MANUTENCAO)!.data.recurso).toBe('manutencao')
  })
})

describe('numerarPassagens', () => {
  it('numera as passagens de cada peça em ordem cronológica (1x, 2x…) com total; 1 passagem = total 1', () => {
    const regs: RegistroPassagem[] = [
      { chave: 'A', sn: 'A', status: 'Aprovado', dataHora: '2026-01-02T10:00:00Z', ordem: 5 }, // 2ª da A
      { chave: 'A', sn: 'A', status: 'Reprovado', dataHora: '2026-01-01T10:00:00Z', ordem: 3 }, // 1ª da A
      { chave: 'B', sn: 'B', status: 'Aprovado', dataHora: '2026-01-01T09:00:00Z', ordem: 1 }, // única da B
    ]
    expect(numerarPassagens(regs)).toEqual([
      { sn: 'A', status: 'Reprovado', ordinal: 1, total: 2 },
      { sn: 'A', status: 'Aprovado', ordinal: 2, total: 2 },
      { sn: 'B', status: 'Aprovado', ordinal: 1, total: 1 },
    ])
  })

  it('desempata pela ordem quando a dataHora é igual', () => {
    const regs: RegistroPassagem[] = [
      { chave: 'A', sn: 'A', status: 'segundo', dataHora: 'T', ordem: 2 },
      { chave: 'A', sn: 'A', status: 'primeiro', dataHora: 'T', ordem: 1 },
    ]
    expect(numerarPassagens(regs).map((p) => p.status)).toEqual(['primeiro', 'segundo'])
  })

  it('ordena as peças pela passagem mais recente primeiro (não alfabético)', () => {
    const regs: RegistroPassagem[] = [
      { chave: 'AAA', sn: 'AAA', status: 'x', dataHora: '2026-01-01T00:00:00Z', ordem: 1 }, // antiga
      { chave: 'ZZZ', sn: 'ZZZ', status: 'y', dataHora: '2026-02-01T00:00:00Z', ordem: 2 }, // recente
    ]
    // recente primeiro → ZZZ antes de AAA (apesar de alfabético ser AAA primeiro)
    expect(numerarPassagens(regs).map((p) => p.sn)).toEqual(['ZZZ', 'AAA'])
  })

  it('lista vazia → vazio', () => {
    expect(numerarPassagens([])).toEqual([])
  })
})

describe('postoPendenteDePeca', () => {
  const postos = ['SPI', 'Teste', 'Burn-in', 'NQA', 'Embalagem']
  const exige = (p: string) => p === 'Teste'
  const recurso = (p: string) => (p === 'Burn-in' ? 'burnin' : 'nenhum')
  const pp = (regs: BipePeca[]) => postoPendenteDePeca(regs, postos, exige, recurso)

  it('aprovada num posto → pendente no PRÓXIMO', () => {
    expect(pp([{ posto: 'SPI', status: 'Aprovado' }])).toBe('Teste')
    expect(pp([{ posto: 'NQA', status: 'Aprovado' }])).toBe('Embalagem') // resolve "NQA pendente E aprovado"
  })

  it('passagem/aprovada no último posto → concluída (null)', () => {
    expect(pp([{ posto: 'Embalagem', status: '' }])).toBeNull()
  })

  it('reprovada → Manutenção se o posto exige; senão o próprio posto (conserto no lugar)', () => {
    expect(pp([{ posto: 'Teste', status: 'Reprovado' }])).toBe(MANUTENCAO)
    expect(pp([{ posto: 'SPI', status: 'Reprovado' }])).toBe('SPI')
  })

  it('NQA caixa reprovada com postoRetorno → pendente no posto escolhido (antes de Manutenção/mesmo posto)', () => {
    expect(pp([{ posto: 'NQA', status: 'Reprovado', postoRetorno: 'Teste' }])).toBe('Teste')
    // postoRetorno vazio → cai na regra padrão (NQA não exige manutenção → próprio posto)
    expect(pp([{ posto: 'NQA', status: 'Reprovado', postoRetorno: '' }])).toBe('NQA')
  })

  it('reteste NQA por lista: pendente no 1º da lista; a propagação avança pelos postos até o NQA', () => {
    // reprova com lista de reteste (postos + NQA no fim) → pendente no 1º
    expect(pp([{ posto: 'NQA', status: 'Reprovado', postoRetorno: 'SPI,Teste,NQA' }])).toBe('SPI')
    // repasse do SPI (aprovado) já traz a lista restante propagada → pendente no Teste
    expect(pp([{ posto: 'SPI', status: 'Aprovado', postoRetorno: 'Teste,NQA' }])).toBe('Teste')
    // repasse do Teste com só o NQA restante → pendente no NQA (reinspeção)
    expect(pp([{ posto: 'Teste', status: 'Aprovado', postoRetorno: 'NQA' }])).toBe('NQA')
  })

  it('Burn-in: entrada (status vazio) → cozinhando no próprio Burn-in; saída aprovada → próximo', () => {
    expect(pp([{ posto: 'Burn-in', status: '' }])).toBe('Burn-in')
    expect(pp([{ posto: 'Burn-in', status: 'Aprovado' }])).toBe('NQA')
  })

  it('usa o ÚLTIMO bipe do histórico', () => {
    expect(pp([{ posto: 'SPI', status: 'Aprovado' }, { posto: 'Teste', status: 'Aprovado' }])).toBe('Burn-in')
  })

  it('sem bipe → primeiro posto', () => {
    expect(pp([])).toBe('SPI')
  })
})

describe('formatarRelogio', () => {
  it('segundos < 1min → MM:SS com minuto zerado', () => {
    expect(formatarRelogio(45)).toBe('00:45')
    expect(formatarRelogio(0)).toBe('00:00')
    expect(formatarRelogio(9)).toBe('00:09')
  })
  it('minutos (< 1h) → MM:SS', () => {
    expect(formatarRelogio(90)).toBe('01:30')
    expect(formatarRelogio(5 * 60 + 30)).toBe('05:30')
    expect(formatarRelogio(59 * 60 + 59)).toBe('59:59')
  })
  it('≥ 1h → HH:MM:SS', () => {
    expect(formatarRelogio(3600)).toBe('01:00:00')
    expect(formatarRelogio(2 * 3600 + 3 * 60 + 4)).toBe('02:03:04')
  })
  it('arredonda e nunca fica negativo', () => {
    expect(formatarRelogio(89.6)).toBe('01:30')
    expect(formatarRelogio(-10)).toBe('00:00')
  })
})
