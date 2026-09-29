import { describe, it, expect } from 'vitest'
import {
  TETO_TENTATIVAS,
  agruparEstoquePendente,
  esperaAEntrada,
  podeReenviar,
  situacaoDaLinha,
  type EntradaDoEstorno,
  type GrupoEstoquePendente,
  type LinhaEstoquePendente,
  type LinhaFilaEstoque,
} from '../estoque-pendente'

const AGORA = new Date('2026-09-29T12:00:00.000Z')

function linha(over: Partial<LinhaFilaEstoque> = {}): LinhaFilaEstoque {
  return {
    id: 'l1',
    chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/E1',
    operacao: 'entrada',
    pmo: 'PMOA01',
    op: '9100',
    posto: 'Almoxarifado',
    tipo: 'caixa',
    bipe: 'CX[1][3]9100-PMOA01',
    alvo: 'CX[1][3]9100-PMOA01',
    quantidade: 3,
    estornado: 0,
    tentativas: 0,
    reservadoEm: null,
    erro: null,
    criadoEm: '2026-09-29T11:00:00.000Z',
    entradaId: null,
    seqChave: 1,
    ...over,
  }
}

/**
 * `noUncheckedIndexedAccess` está ligado no projeto: indexar um array devolve `T | undefined`. Estes
 * dois ajudantes afirmam a existência ANTES de usar, então um agrupamento que devolvesse lista vazia
 * falha o teste com uma mensagem, em vez de estourar num acesso a `undefined`.
 */
function primeiro<T>(itens: T[]): T {
  expect(itens.length).toBeGreaterThan(0)
  return itens[0] as T
}
function umGrupo(grupos: GrupoEstoquePendente[]): GrupoEstoquePendente {
  expect(grupos).toHaveLength(1)
  return primeiro(grupos)
}

function entrada(over: Partial<EntradaDoEstorno> = {}): EntradaDoEstorno {
  return { id: 'e1', chave: 'ALMOX/.../E1', ok: false, canceladoEm: null, tentativas: 0, ...over }
}

describe('situação de uma linha da fila de estoque', () => {
  it('linha nova, nunca tentada, está só na fila', () => {
    expect(situacaoDaLinha(linha(), new Map(), AGORA)).toBe('na_fila')
  })

  it('reserva viva ganha de tudo: uma rodada está entregando a linha agora', () => {
    // A reserva vale 15 min; 14 ainda é viva. É o único estado em que mexer é errado (duas rodadas
    // mandariam a mesma movimentação ao ERP), por isso ele decide primeiro.
    const l = linha({ tentativas: TETO_TENTATIVAS, reservadoEm: '2026-09-29T11:46:00.000Z' })
    expect(situacaoDaLinha(l, new Map(), AGORA)).toBe('enviando')
    expect(podeReenviar(situacaoDaLinha(l, new Map(), AGORA))).toBe(false)
  })

  it('reserva VENCIDA não segura mais nada: a linha volta a ser lida pelo estado dela', () => {
    const l = linha({ tentativas: 2, reservadoEm: '2026-09-29T11:40:00.000Z', erro: 'timeout' })
    expect(situacaoDaLinha(l, new Map(), AGORA)).toBe('vai_tentar')
  })

  it('linha que gastou o teto saiu da fila, e é a única que o Reenviar resolve', () => {
    const l = linha({ tentativas: TETO_TENTATIVAS, erro: 'Compels não configurado' })
    expect(situacaoDaLinha(l, new Map(), AGORA)).toBe('fora_da_fila')
    expect(podeReenviar('fora_da_fila')).toBe(true)
    for (const s of ['enviando', 'esperando_entrada', 'vai_tentar', 'na_fila'] as const) {
      expect(podeReenviar(s)).toBe(false)
    }
  })
})

/**
 * O RÓTULO "ESPERANDO A ENTRADA" — o estado invisível. Um estorno retido tem `tentativas = 0` e
 * `erro` nulo: numa lista de pendências comum ele é indistinguível de uma linha que acabou de entrar
 * na fila, e foi por ser invisível que dois defeitos passaram pelas revisões das Tasks 2-4.
 */
describe('o rótulo "esperando a entrada"', () => {
  it('aparece no estorno cuja entrada gravada NÃO está ok', () => {
    const entradas = new Map([['e1', entrada({ ok: false })]])
    const s = linha({ id: 's1', operacao: 'estorno', entradaId: 'e1', seqChave: 1, quantidade: 3 })
    expect(esperaAEntrada(s, entradas)).toBe(true)
    expect(situacaoDaLinha(s, entradas, AGORA)).toBe('esperando_entrada')
  })

  it('NÃO aparece num pendente comum (entrada nova, na fila)', () => {
    expect(situacaoDaLinha(linha(), new Map(), AGORA)).toBe('na_fila')
    expect(esperaAEntrada(linha(), new Map())).toBe(false)
  })

  it('NÃO aparece no estorno cuja entrada já chegou ao ERP — ele está liberado', () => {
    const entradas = new Map([['e1', entrada({ ok: true })]])
    const s = linha({ id: 's1', operacao: 'estorno', entradaId: 'e1' })
    expect(esperaAEntrada(s, entradas)).toBe(false)
    expect(situacaoDaLinha(s, entradas, AGORA)).toBe('na_fila')
  })

  it('estorno SEM vínculo (ou com vínculo que não veio na leitura) também é retido: sem saber, segura', () => {
    // É a mesma escolha do `coalesce(..., false)` do predicado da sf_estoque_reservar: liberar
    // mandaria ao ERP uma saída de peça que ele nunca recebeu.
    const semVinculo = linha({ id: 's1', operacao: 'estorno', entradaId: null })
    expect(situacaoDaLinha(semVinculo, new Map(), AGORA)).toBe('esperando_entrada')
    const vinculoPerdido = linha({ id: 's2', operacao: 'estorno', entradaId: 'nao-veio' })
    expect(situacaoDaLinha(vinculoPerdido, new Map(), AGORA)).toBe('esperando_entrada')
  })

  it('o que fazer MUDA com o estado da entrada, porque o gesto é diferente em cada caso', () => {
    const casos: [EntradaDoEstorno | null, RegExp][] = [
      [entrada({ ok: false, tentativas: 1 }), /ainda está na fila/i],
      [entrada({ ok: false, tentativas: TETO_TENTATIVAS }), /Reenviar NA LINHA DA ENTRADA/],
      [entrada({ ok: false, canceladoEm: '2026-09-29T10:00:00.000Z' }), /CANCELADA/],
      [null, /não tem entrada vinculada/i],
    ]
    for (const [e, esperado] of casos) {
      const entradas = new Map(e ? [['e1', e]] : [])
      const grupo = umGrupo(agruparEstoquePendente(
        [linha({ id: 's1', operacao: 'estorno', entradaId: 'e1', quantidade: 3 })],
        entradas,
        AGORA,
      ))
      const l = primeiro(grupo.linhas)
      expect(l.rotulo).toBe('Esperando a entrada')
      expect(l.oQueFazer).toMatch(esperado)
    }
  })
})

describe('o saldo, e não a quantidade cheia', () => {
  it('entrada de 3 com 2 estornados vale 1 peça', () => {
    const g = umGrupo(agruparEstoquePendente([linha({ quantidade: 3, estornado: 2 })], new Map(), AGORA))
    expect(primeiro(g.linhas).saldo).toBe(1)
    expect(primeiro(g.linhas).quantidade).toBe(3)
  })

  it('estorno vale a própria quantidade (estorno não se estorna)', () => {
    const g = umGrupo(agruparEstoquePendente(
      [linha({ id: 's1', operacao: 'estorno', entradaId: 'e1', quantidade: 2, estornado: 0 })],
      new Map([['e1', entrada({ ok: true })]]),
      AGORA,
    ))
    expect(primeiro(g.linhas).saldo).toBe(2)
  })
})

/**
 * O PAR TEM DE APARECER JUNTO: o que o gestor decide é sobre o par, não sobre uma linha. Uma entrada
 * que estourou o teto segura o estorno dela para sempre, e só um Reenviar humano NA ENTRADA destrava
 * os dois — se eles caírem em cantos diferentes da tela, a ligação não se acha.
 */
describe('agrupamento por bipe (pmo/op/posto/alvo)', () => {
  const ENTRADA_TRAVADA = linha({
    id: 'e1',
    chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/E1',
    tentativas: TETO_TENTATIVAS,
    erro: 'Compels: envio não implementado',
    quantidade: 3,
    estornado: 3,
    criadoEm: '2026-09-29T11:00:00.000Z',
    seqChave: 1,
  })
  const ESTORNO_RETIDO = linha({
    id: 's1',
    chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/S1',
    operacao: 'estorno',
    entradaId: 'e1',
    quantidade: 3,
    criadoEm: '2026-09-29T11:30:00.000Z',
    seqChave: 1,
  })

  it('a entrada travada e o estorno retido dela ficam no MESMO grupo', () => {
    const grupos = agruparEstoquePendente(
      [ESTORNO_RETIDO, ENTRADA_TRAVADA],
      new Map([['e1', entrada({ id: 'e1', ok: false, tentativas: TETO_TENTATIVAS })]]),
      AGORA,
    )
    const g = umGrupo(grupos)
    expect(g.id).toBe('PMOA01|9100|Almoxarifado|CX[1][3]9100-PMOA01')
    // A ENTRADA vem antes do estorno: é a ordem dos fatos, e é ela que faz "reenvie a entrada, a de
    // cima" ser uma instrução verdadeira.
    expect(g.linhas.map((l) => l.id)).toEqual(['e1', 's1'])
    const [ent, est] = [g.linhas[0] as LinhaEstoquePendente, g.linhas[1] as LinhaEstoquePendente]
    expect(ent.situacao).toBe('fora_da_fila')
    expect(ent.podeReenviar).toBe(true)
    expect(est.situacao).toBe('esperando_entrada')
    // O botão NÃO fica no estorno: quem o destrava é a entrada.
    expect(est.podeReenviar).toBe(false)
  })

  it('bipes diferentes ficam em grupos diferentes, o mais recente primeiro', () => {
    const outro = linha({
      id: 'x1',
      op: '9200',
      alvo: 'CX[1][5]9200-PMOA01',
      criadoEm: '2026-09-29T11:59:00.000Z',
    })
    const grupos = agruparEstoquePendente(
      [ENTRADA_TRAVADA, outro],
      new Map(),
      AGORA,
    )
    expect(grupos.map((g) => g.op)).toEqual(['9200', '9100'])
  })

  it('o mesmo alvo em POSTOS diferentes não se mistura (o posto faz parte da identidade do bipe)', () => {
    const grupos = agruparEstoquePendente(
      [ENTRADA_TRAVADA, linha({ id: 'e2', posto: 'Almoxarifado 2' })],
      new Map(),
      AGORA,
    )
    expect(grupos).toHaveLength(2)
  })

  it('vários estornos do mesmo bipe saem em ordem de chave (S1, S2)', () => {
    const s2 = linha({
      id: 's2',
      operacao: 'estorno',
      entradaId: 'e1',
      quantidade: 1,
      criadoEm: '2026-09-29T11:20:00.000Z',
      seqChave: 2,
    })
    const g = umGrupo(agruparEstoquePendente(
      [s2, ESTORNO_RETIDO, ENTRADA_TRAVADA],
      new Map([['e1', entrada({ id: 'e1', ok: false, tentativas: TETO_TENTATIVAS })]]),
      AGORA,
    ))
    // seq_chave manda, e não `criado_em`: o S2 é mais antigo no relógio e ainda assim vem depois do S1.
    expect(g.linhas.map((l) => l.id)).toEqual(['e1', 's1', 's2'])
  })
})
