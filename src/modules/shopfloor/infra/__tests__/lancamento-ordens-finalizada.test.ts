// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolverOpPorSn } from '../../domain/cabecalho-lancamento'

vi.mock('server-only', () => ({}))

/**
 * Supabase de mentira para `sf_ordens`: aplica DE VERDADE os `eq`/`neq` pedidos, devolve SÓ as
 * colunas do `select` e corta em 1000 linhas por consulta, como o PostgREST (max_rows).
 *
 * Aplicar o filtro de verdade é o que faz o teste morrer se o `.neq('status','FINALIZADA')` voltar
 * pra fonte de dados da tela de Lançamento. Recortar as colunas é o que faz o teste morrer se
 * `status` sair do `select`: sem ele toda OP volta parecendo ATIVA e a busca em duas etapas do
 * cabeçalho carregaria a OP finalizada calada, como antes do adendo de 09/10/2026.
 */
const MAX_ROWS = 1000
let ordens: Record<string, unknown>[] = []

/** Nomes de coluna de topo do `select` do PostgREST ("a,b,rel(x,y)" -> [a, b, rel]). */
function colunasDoSelect(cols: string): string[] {
  const nomes: string[] = []
  let profundidade = 0
  let atual = ''
  for (const ch of cols) {
    if (ch === '(') { profundidade++; continue }
    if (ch === ')') { profundidade--; continue }
    if (ch === ',' && profundidade === 0) { nomes.push(atual); atual = ''; continue }
    if (profundidade === 0) atual += ch
  }
  nomes.push(atual)
  return nomes.map((n) => n.trim()).filter((n) => n !== '')
}

function consulta() {
  const filtros: { tipo: 'eq' | 'neq'; coluna: string; valor: string }[] = []
  let colunas: string[] | null = null
  let de = 0
  let ate = Number.POSITIVE_INFINITY
  const q = {
    select(cols?: string) {
      colunas = typeof cols === 'string' ? colunasDoSelect(cols) : null
      return q
    },
    eq(coluna: string, valor: string) {
      filtros.push({ tipo: 'eq', coluna, valor })
      return q
    },
    neq(coluna: string, valor: string) {
      filtros.push({ tipo: 'neq', coluna, valor })
      return q
    },
    order: () => q,
    range(a: number, b: number) {
      de = a
      ate = b
      return q
    },
    then(ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) {
      let fonte = [...ordens]
      for (const f of filtros) {
        fonte = fonte.filter((r) =>
          f.tipo === 'eq' ? String(r[f.coluna] ?? '') === f.valor : String(r[f.coluna] ?? '') !== f.valor,
        )
      }
      const fim = Math.min(ate + 1, de + MAX_ROWS)
      const cols = colunas
      const pagina = fonte
        .slice(de, fim)
        .map((r) => (cols === null ? r : Object.fromEntries(cols.map((c) => [c, r[c]]))))
      return Promise.resolve({ data: pagina, error: null }).then(ok, falhou)
    },
  }
  return q
}

vi.mock('@/shared/lib/supabase/server', () => ({
  createServerSupabase: async () => ({ from: () => consulta() }),
}))

const { listarOrdensParaLancamento, listarClientes, listarPmos, listarOps } = await import(
  '../lancamento-repository'
)

function ordem(
  pmo: string,
  op: string,
  status: string,
  snIni: string,
  snFim: string,
  extra: Record<string, unknown> = {},
) {
  return {
    cliente: 'Enterplak',
    pmo,
    op,
    descricao: `Produto ${pmo}`,
    qtd: 100,
    sn_ini: snIni,
    sn_fim: snFim,
    embalagem_individual: false,
    status,
    sf_ordem_postos: [],
    sf_ordem_componentes: [],
    sf_ordem_burnin: [],
    ...extra,
  }
}

const ATIVA = ordem('PMOA', '8801', 'ATIVA', 'A100', 'A199')
// A OP que o gestor finalizou à mão (ou que a rotina finalizou): as peças dela continuam na fábrica.
const FINALIZADA = ordem('PMOB', '8802', 'FINALIZADA', 'B100', 'B199', {
  qtd: 42,
  sf_ordem_postos: [
    { posto: 'Embalagem', ordem: 3 },
    { posto: 'Montagem', ordem: 1 },
    { posto: 'Burn-in', ordem: 2 },
  ],
  sf_ordem_componentes: [{ posto: 'Montagem', pmo_componente: 'PMOPLACA' }],
  sf_ordem_burnin: [{ posto: 'Burn-in', tempo_min: 360 }],
})

beforeEach(() => {
  ordens = [ATIVA, FINALIZADA]
})

describe('OP finalizada na tela de Lançamento', () => {
  it('a OP FINALIZADA continua na lista, e o cabeçalho a reconhece como finalizada', async () => {
    // A lista é a fonte de dados da tela inteira: a OP finalizada TEM de vir (senão a tela perde o
    // contexto). Quem decide o que fazer com ela é a busca do cabeçalho, que agora bloqueia em vez
    // de responder "SN não encontrado".
    const lista = await listarOrdensParaLancamento()

    const r = resolverOpPorSn(lista, 'B150')

    expect(r).toMatchObject({ ok: false, erro: 'OP_FINALIZADA' })
    expect(!r.ok && r.erro === 'OP_FINALIZADA' && { pmo: r.ordem.pmo, op: r.ordem.op }).toEqual({
      pmo: 'PMOB',
      op: '8802',
    })
  })

  it('o status de cada OP vem do banco na lista (sem ele, finalizada passaria por ativa)', async () => {
    const lista = await listarOrdensParaLancamento()

    expect(lista.map((o) => [o.op, o.status])).toEqual([
      ['8801', 'ATIVA'],
      ['8802', 'FINALIZADA'],
    ])
  })

  it('SN de OP ATIVA carrega como sempre (a etapa 2 não atrapalha o caminho normal)', async () => {
    const lista = await listarOrdensParaLancamento()

    const r = resolverOpPorSn(lista, 'A150')

    expect(r.ok).toBe(true)
    expect(r.ok && { pmo: r.ordem.pmo, op: r.ordem.op }).toEqual({ pmo: 'PMOA', op: '8801' })
  })

  it('SN que cai na FINALIZADA e numa ATIVA carrega a ATIVA, sem ambiguidade', async () => {
    // Faixa cadastrada errada (caso 1 do adendo): a etapa 1 acha a ativa e para ali.
    ordens = [ordem('PMOA', '8801', 'ATIVA', 'B100', 'B199'), FINALIZADA]
    const lista = await listarOrdensParaLancamento()

    const r = resolverOpPorSn(lista, 'B150')

    expect(r.ok && { pmo: r.ordem.pmo, op: r.ordem.op }).toEqual({ pmo: 'PMOA', op: '8801' })
  })

  it('a OP FINALIZADA volta COMPLETA: postos na ordem, receita, burn-in e quantidade', async () => {
    // É o que a tela precisa pra montar o contexto depois do bipe. Se o filtro de status voltar à
    // fonte de dados da tela, a OP desaparece daqui e o `find` do `ordemSel` devolve null.
    const lista = await listarOrdensParaLancamento()

    const o = lista.find((x) => x.pmo === 'PMOB' && x.op === '8802')

    expect(o).toMatchObject({
      cliente: 'Enterplak',
      qtd: 42,
      sn_ini: 'B100',
      sn_fim: 'B199',
      postos: ['Montagem', 'Burn-in', 'Embalagem'],
      receitaPorPosto: { Montagem: ['PMOPLACA'] },
      tempoBurninPorPosto: { 'Burn-in': 360 },
    })
  })

  it('a lista não para nas 1000 primeiras OPs — a finalizada da ponta ainda vem', async () => {
    // Sem o filtro de status a tabela inteira entra na consulta; sem paginar, o PostgREST cortaria
    // em 1000 linhas e OPs ATIVAS também sumiriam em silêncio.
    const enchimento = Array.from({ length: 1200 }, (_, i) =>
      ordem(`PMOX${i}`, String(9000 + i), 'ATIVA', `X${i}00001`, `X${i}00099`),
    )
    ordens = [...enchimento, FINALIZADA]

    const lista = await listarOrdensParaLancamento()

    expect(lista).toHaveLength(1201)
    const r = resolverOpPorSn(lista, 'B150')
    expect(r).toMatchObject({ ok: false, erro: 'OP_FINALIZADA' })
    expect(!r.ok && r.erro === 'OP_FINALIZADA' && r.ordem.op).toBe('8802')
  })

  it('o seletor em cascata continua escondendo a OP FINALIZADA', async () => {
    // Não poluir a lista de escolha do operador é o comportamento desejado da cascata.
    expect(await listarClientes()).toEqual(['Enterplak'])
    expect(await listarPmos('Enterplak')).toEqual(['PMOA'])
    expect((await listarOps('Enterplak', 'PMOB')).map((r) => r.op)).toEqual([])
    expect((await listarOps('Enterplak', 'PMOA')).map((r) => r.op)).toEqual(['8801'])
  })
})
