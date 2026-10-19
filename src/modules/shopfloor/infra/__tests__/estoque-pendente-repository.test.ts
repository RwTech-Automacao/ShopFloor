import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TENTATIVAS_APOS_REENVIO,
  TETO_TENTATIVAS,
  agruparEstoquePendente,
} from '../../domain/estoque-pendente'

vi.mock('server-only', () => ({}))

/**
 * O QUE ESTE ARQUIVO GUARDA, e por que ele existe: a ESCRITA do Reenviar e a ORDEM da leitura da
 * tela. As duas eram provadas em nenhum lugar — a Server Action é testada com este repositório
 * MOCKADO, então o que ela garante é a constante e o log, não o `update`. Trocar
 * `TENTATIVAS_APOS_REENVIO` por `0` na linha do `update` (o defeito exato que a decisão existe para
 * impedir: `tentativas = 0` apaga a marca de LINHA TOCADA e faz a `sf_estoque_reverter` CANCELAR uma
 * entrada que pode já estar no Compels) deixava a suíte inteira verde, e remover a cerca
 * `.gte('tentativas', …)` — a que impede um POST forjado de sujar uma linha limpa e a corrida
 * leitura↔cron — também.
 */

/** Uma chamada capturada: a tabela, as colunas, o payload do update, os filtros, ordens e limite. */
interface Chamada {
  tabela: string
  colunas?: string
  update?: Record<string, unknown>
  /** `[operador, coluna, valor]` — o operador importa: `eq('ok', false)` não é `is('ok', null)`. */
  filtros: [string, string, unknown][]
  ordens: [string, boolean][]
  limite?: number
}

/**
 * Supabase de mentira: guarda cada `from(...)` com o que foi pedido nela e devolve a resposta que o
 * teste mandar. Não reimplementa filtro nem ordenação de propósito — o que se prova aqui é O QUE FOI
 * PEDIDO AO BANCO (o banco de verdade é provado no `estoque_envios_test.sql`).
 */
function sbFalso(resposta: (c: Chamada, indice: number) => { data: unknown; error: unknown }) {
  const chamadas: Chamada[] = []
  function construtor(tabela: string) {
    const c: Chamada = { tabela, filtros: [], ordens: [] }
    const indice = chamadas.push(c) - 1
    const q = {
      select(colunas?: string) {
        if (colunas !== undefined) c.colunas = colunas
        return q
      },
      update(v: Record<string, unknown>) {
        c.update = v
        return q
      },
      eq(col: string, v: unknown) {
        c.filtros.push(['eq', col, v])
        return q
      },
      is(col: string, v: unknown) {
        c.filtros.push(['is', col, v])
        return q
      },
      gte(col: string, v: unknown) {
        c.filtros.push(['gte', col, v])
        return q
      },
      in(col: string, v: unknown) {
        c.filtros.push(['in', col, v])
        return q
      },
      order(col: string, opcoes?: { ascending?: boolean }) {
        c.ordens.push([col, opcoes?.ascending !== false])
        return q
      },
      limit(n: number) {
        c.limite = n
        return q
      },
      maybeSingle() {
        return q
      },
      then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
        return Promise.resolve(resposta(c, indice)).then(ok, erro)
      },
    }
    return q
  }
  return { sb: { from: construtor } as unknown as SupabaseClient, chamadas }
}

const { createServerSupabase, createServiceSupabase } = vi.hoisted(() => ({
  createServerSupabase: vi.fn(),
  createServiceSupabase: vi.fn(),
}))
vi.mock('@/shared/lib/supabase/server', () => ({ createServerSupabase }))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase }))

import { liberarParaReenvio, listarEstoquePendente } from '../estoque-pendente-repository'

/** Uma linha crua da fila, como o PostgREST devolve. */
function bruta(over: Record<string, unknown> = {}) {
  return {
    id: 'e1',
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
    tentativas: TETO_TENTATIVAS,
    reservado_em: null,
    erro: 'Compels: envio ao ERP ainda não implementado',
    criado_em: '2026-09-29T11:00:00.000Z',
    entrada_id: null,
    seq_chave: 1,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('o Reenviar escreve tentativas = 1, e nunca 0', () => {
  it('o payload do update é exatamente { tentativas: 1, reservado_em: null, adiado_ate: null }', async () => {
    const { sb, chamadas } = sbFalso(() => ({ data: [{ id: 'e1' }], error: null }))
    createServiceSupabase.mockReturnValue(sb)

    expect(await liberarParaReenvio('e1')).toBe(true)
    const c = chamadas[0] as Chamada
    expect(c.tabela).toBe('sf_estoque_envios')
    // O NÚMERO, cravado: `tentativas = 0` apagaria a marca de LINHA TOCADA e reabriria o caminho do
    // ajuste/cancelamento numa linha que pode já estar no Compels. Ver A DECISÃO na Server Action.
    expect(c.update).toEqual({ tentativas: 1, reservado_em: null, adiado_ate: null })
    expect(c.update?.tentativas).toBe(TENTATIVAS_APOS_REENVIO)
    expect(c.update?.tentativas).not.toBe(0)
    // e nada além disso é tocado: `erro` (o motivo que a tela mostra), `chave` (a idempotência do
    // ERP), `quantidade` e `estornado` (o que o ERP recebeu e o que já foi devolvido) ficam.
    expect(Object.keys(c.update ?? {}).sort()).toEqual(['adiado_ate', 'reservado_em', 'tentativas'])
  })

  it('a cerca do update repete as QUATRO condições, inclusive o teto de tentativas', async () => {
    const { sb, chamadas } = sbFalso(() => ({ data: [{ id: 'e1' }], error: null }))
    createServiceSupabase.mockReturnValue(sb)

    await liberarParaReenvio('e1')
    // Sem a cerca, uma rodada do cron que entregou a linha entre a leitura e a escrita a veria
    // ressuscitar como pendente, e um POST forjado com o id de uma linha LIMPA a sujaria.
    expect((chamadas[0] as Chamada).filtros).toEqual([
      ['eq', 'id', 'e1'],
      ['eq', 'ok', false],
      ['is', 'cancelado_em', null],
      ['gte', 'tentativas', TETO_TENTATIVAS],
    ])
  })

  it('quando a cerca não casa (zero linha afetada) o resultado é false, não um sucesso calado', async () => {
    const { sb } = sbFalso(() => ({ data: [], error: null }))
    createServiceSupabase.mockReturnValue(sb)
    expect(await liberarParaReenvio('e1')).toBe(false)
  })
})

describe('a leitura da tela não esconde quem precisa de gente', () => {
  it('pede ACIONABILIDADE antes da data, e lê limite + 1', async () => {
    const { sb, chamadas } = sbFalso(() => ({ data: [bruta()], error: null }))
    createServerSupabase.mockResolvedValue(sb)

    await listarEstoquePendente(200)
    const c = chamadas[0] as Chamada
    // `tentativas desc` primeiro: quem está no teto (a única situação em que o Reenviar se aplica) é
    // o mais ANTIGO da fila e seria o primeiro a cair de um corte por data.
    expect(c.ordens).toEqual([['tentativas', false], ['criado_em', false]])
    expect(c.limite).toBe(201)
    expect(c.filtros).toEqual([['eq', 'ok', false], ['is', 'cancelado_em', null]])
  })

  it('com exatamente `limite` linhas na fila NÃO diz que há mais', async () => {
    const linhas = Array.from({ length: 3 }, (_, i) => bruta({ id: `e${i}` }))
    const { sb } = sbFalso(() => ({ data: linhas, error: null }))
    createServerSupabase.mockResolvedValue(sb)

    const r = await listarEstoquePendente(3)
    expect(r.cortada).toBe(false)
    expect(r.linhas).toHaveLength(3)
  })

  it('com `limite + 1` diz que há mais e mostra só `limite` (a linha extra é descartada)', async () => {
    const linhas = Array.from({ length: 4 }, (_, i) => bruta({ id: `e${i}` }))
    const { sb } = sbFalso(() => ({ data: linhas, error: null }))
    createServerSupabase.mockResolvedValue(sb)

    const r = await listarEstoquePendente(3)
    expect(r.cortada).toBe(true)
    expect(r.linhas.map((l) => l.id)).toEqual(['e0', 'e1', 'e2'])
  })
})

describe('o par entrada+estorno não chega quebrado', () => {
  const ESTORNO = bruta({
    id: 's1',
    chave: 'ALMOX/PMOA01/9100/Almoxarifado/CX[1][3]9100-PMOA01/S1',
    operacao: 'estorno',
    quantidade: 2,
    tentativas: 0,
    erro: null,
    criado_em: '2026-09-29T11:30:00.000Z',
    entrada_id: 'e1',
    seq_chave: 1,
  })
  const OUTRO_BIPE = bruta({ id: 'x1', op: '9200', alvo: 'CX[1][5]9200-PMOA01' })

  it('a ENTRADA que ficou fora do corte entra na lista, e o grupo do bipe fica inteiro', async () => {
    // O corte de 2 leva o estorno e um bipe de outra OP; a entrada do estorno fica de fora — é
    // sempre ela, porque o estorno é criado DEPOIS. Sem ela na lista, a frase "Aperte Reenviar NA
    // LINHA DA ENTRADA (a de cima, neste mesmo bipe)" aponta para uma linha que não existe na tela.
    const { sb, chamadas } = sbFalso((c) =>
      c.filtros.some(([op]) => op === 'in')
        ? { data: [{ ...bruta({ id: 'e1' }), ok: false, cancelado_em: null }], error: null }
        : { data: [ESTORNO, OUTRO_BIPE], error: null })
    createServerSupabase.mockResolvedValue(sb)

    const r = await listarEstoquePendente(2)
    expect(r.linhas.map((l) => l.id).sort()).toEqual(['e1', 's1', 'x1'])
    expect(r.entradas.get('e1')?.tentativas).toBe(TETO_TENTATIVAS)
    // a segunda leitura traz a linha inteira, não só o estado
    expect((chamadas[1] as Chamada).colunas).toContain('quantidade')

    // e a tela: um grupo com a entrada em cima do estorno, com o botão na entrada
    const grupos = agruparEstoquePendente(r.linhas, r.entradas, new Date('2026-09-29T12:00:00.000Z'))
    const par = grupos.find((g) => g.op === '9100')
    expect(par?.linhas.map((l) => l.id)).toEqual(['e1', 's1'])
    expect(par?.linhas[0]?.podeReenviar).toBe(true)
    // o grupo que pede gesto vem antes do bipe mais novo que não pede nada
    expect(grupos.map((g) => g.op)).toEqual(['9100', '9200'])
  })

  it('a entrada que JÁ está na lista não é duplicada', async () => {
    const { sb } = sbFalso((c) =>
      c.filtros.some(([op]) => op === 'in')
        ? { data: [{ ...bruta({ id: 'e1' }), ok: false, cancelado_em: null }], error: null }
        : { data: [ESTORNO, bruta({ id: 'e1' })], error: null })
    createServerSupabase.mockResolvedValue(sb)

    const r = await listarEstoquePendente(200)
    expect(r.linhas.filter((l) => l.id === 'e1')).toHaveLength(1)
  })

  it('a entrada já entregue ou CANCELADA explica o estorno, mas não entra na lista de pendências', async () => {
    const { sb } = sbFalso((c) =>
      c.filtros.some(([op]) => op === 'in')
        ? {
          data: [
            { ...bruta({ id: 'e1' }), ok: true, cancelado_em: null },
            { ...bruta({ id: 'e2' }), ok: false, cancelado_em: '2026-09-29T10:00:00.000Z' },
          ],
          error: null,
        }
        : { data: [ESTORNO, { ...ESTORNO, id: 's2', entrada_id: 'e2' }], error: null })
    createServerSupabase.mockResolvedValue(sb)

    const r = await listarEstoquePendente(200)
    expect(r.linhas.map((l) => l.id).sort()).toEqual(['s1', 's2'])
    expect(r.entradas.get('e1')?.ok).toBe(true)
    expect(r.entradas.get('e2')?.canceladoEm).toBe('2026-09-29T10:00:00.000Z')
  })

  it('os ids da segunda leitura vão em lotes de 50 (a URL do `in` não estoura o nginx)', async () => {
    const estornos = Array.from({ length: 120 }, (_, i) =>
      ({ ...ESTORNO, id: `s${i}`, entrada_id: `e${i}` }))
    const { sb, chamadas } = sbFalso((c) =>
      c.filtros.some(([op]) => op === 'in')
        ? { data: [], error: null }
        : { data: estornos, error: null })
    createServerSupabase.mockResolvedValue(sb)

    await listarEstoquePendente(200)
    const lotes = chamadas
      .flatMap((c) => c.filtros)
      .filter(([op]) => op === 'in')
      .map(([, , ids]) => (ids as string[]).length)
    expect(lotes).toEqual([50, 50, 20])
  })
})
