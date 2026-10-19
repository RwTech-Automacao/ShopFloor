import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioEstoqueEnvios, lerEnvioEstoque } from '../estoque-envios-repository'
import type { EnvioEstoqueReservado } from '../../application/enviar-estoque'

interface Chamada {
  tabela: string
  update?: Record<string, unknown>
  filtros: [string, unknown][]
}

/**
 * Supabase de mentira: guarda cada `from(...).update(...).eq/.is(...)` e cada `rpc(...)`. As "linhas
 * afetadas" são decididas pelo teste — é assim que se prova a cerca (quando o filtro não casa, o
 * banco devolve zero linha e o resultado tem que ser descartado, não gravado à força).
 */
function sbFalso(opcoes: {
  rpc?: (nome: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }
  linhasAfetadas?: (c: Chamada) => number
} = {}) {
  const chamadas: Chamada[] = []
  const rpcs: { nome: string; args: Record<string, unknown> }[] = []
  function construtor(tabela: string) {
    const c: Chamada = { tabela, filtros: [] }
    chamadas.push(c)
    const resultado = () => {
      const n = opcoes.linhasAfetadas?.(c) ?? 1
      return { data: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })), error: null }
    }
    const q = {
      update(v: Record<string, unknown>) {
        c.update = v
        return q
      },
      eq(col: string, v: unknown) {
        c.filtros.push([col, v])
        return q
      },
      is(col: string, v: unknown) {
        c.filtros.push([col, v])
        return q
      },
      select() {
        return q
      },
      then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
        return Promise.resolve(resultado()).then(ok, erro)
      },
    }
    return q
  }
  const sb = {
    from: construtor,
    async rpc(nome: string, args: Record<string, unknown>) {
      rpcs.push({ nome, args })
      return opcoes.rpc?.(nome, args) ?? { data: [], error: null }
    },
  } as unknown as SupabaseClient
  return { sb, chamadas, rpcs }
}

const LINHA_RPC = {
  id: 'e1',
  chave: 'ALMOX/PMOT01/9900/Almoxarifado/CX[1][3]9900-PMOT01/E1',
  operacao: 'entrada',
  pmo: 'PMOT01',
  op: '9900',
  posto: 'Almoxarifado',
  tipo: 'caixa',
  bipe: 'CX[1][3]9900-PMOT01',
  serie_norm: '',
  quantidade: 3,
  tentativas: 1,
  criado_em: '2026-09-29T10:00:00Z',
}

const ENVIO: EnvioEstoqueReservado = {
  id: 'e1',
  chave: LINHA_RPC.chave,
  operacao: 'entrada',
  pmo: 'PMOT01',
  op: '9900',
  posto: 'Almoxarifado',
  tipo: 'caixa',
  bipe: LINHA_RPC.bipe,
  serieNorm: '',
  quantidade: 3,
  tentativas: 2,
  criadoEm: LINHA_RPC.criado_em,
}

describe('lerEnvioEstoque', () => {
  it('lê a linha da reserva e converte os nomes das colunas', () => {
    expect(lerEnvioEstoque(LINHA_RPC)).toMatchObject({
      id: 'e1', operacao: 'entrada', tipo: 'caixa', quantidade: 3, tentativas: 1, serieNorm: '',
    })
  })

  it('recusa o que este código não entende (e quem chama conclui como falha)', () => {
    // operacao/tipo novos no banco, id ou chave vazios, quantidade que não é positiva: em todos, ler
    // "meio certo" seria mandar ao ERP uma movimentação que ninguém sabe o que é.
    expect(lerEnvioEstoque({ ...LINHA_RPC, operacao: 'transferencia' })).toBeNull()
    expect(lerEnvioEstoque({ ...LINHA_RPC, tipo: 'palete' })).toBeNull()
    expect(lerEnvioEstoque({ ...LINHA_RPC, id: '' })).toBeNull()
    expect(lerEnvioEstoque({ ...LINHA_RPC, chave: '' })).toBeNull()
    expect(lerEnvioEstoque({ ...LINHA_RPC, quantidade: 0 })).toBeNull()
    expect(lerEnvioEstoque(null)).toBeNull()
  })
})

describe('reservarPendentes', () => {
  it('chama a sf_estoque_reservar com o limite do lote', async () => {
    const { sb, rpcs } = sbFalso({ rpc: () => ({ data: [LINHA_RPC], error: null }) })
    const lote = await criarRepositorioEstoqueEnvios(sb).reservarPendentes(30)
    expect(rpcs).toEqual([{ nome: 'sf_estoque_reservar', args: { p_limite: 30 } }])
    expect(lote.envios.map((l) => l.chave)).toEqual([LINHA_RPC.chave])
    expect(lote.ilegiveis).toBe(0)
  })

  it('linha ilegível é concluída como FALHA e CONTADA pra quem chama', async () => {
    // Se fosse só pulada, ela voltaria a cada 15 min para sempre, ocupando lugar no lote e sem nunca
    // registrar nada — ninguém veria que existe uma linha com defeito de dado. E a CONTAGEM tem que
    // sair daqui: é ela que vira falha no resumo (o log do cron é o único olho nesta fila) e é ela que
    // faz o laço saber que o lote veio cheio — sem ela, uma rodada com linha ilegível reportava
    // `falhas: 0` e o laço parava achando o lote incompleto.
    const { sb, chamadas } = sbFalso({
      rpc: () => ({ data: [{ ...LINHA_RPC, operacao: 'transferencia' }], error: null }),
    })
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(await criarRepositorioEstoqueEnvios(sb).reservarPendentes(30)).toEqual({
        envios: [], ilegiveis: 1,
      })
    } finally {
      erros.mockRestore()
    }
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.tabela).toBe('sf_estoque_envios')
    expect(chamadas[0]!.update).toMatchObject({ ok: false, reservado_em: null })
    expect(String(chamadas[0]!.update!.erro)).toContain('Linha ilegível')
    expect(chamadas[0]!.filtros).toEqual([['id', 'e1'], ['tentativas', 1], ['cancelado_em', null]])
  })
})

describe('concluirEnvio', () => {
  it('sucesso: ok com enviado_em, sem erro, e a reserva solta', async () => {
    const { sb, chamadas } = sbFalso()
    await criarRepositorioEstoqueEnvios(sb).concluirEnvio(ENVIO, { ok: true })
    expect(chamadas[0]!.update).toMatchObject({ ok: true, erro: null, reservado_em: null })
    // o CHECK da 0132 é ok = (enviado_em is not null): um sem o outro derruba a escrita
    expect(typeof chamadas[0]!.update!.enviado_em).toBe('string')
  })

  it('falha: guarda o motivo, sem enviado_em, e a linha volta pra fila', async () => {
    const { sb, chamadas } = sbFalso()
    await criarRepositorioEstoqueEnvios(sb).concluirEnvio(ENVIO, { ok: false, erro: 'ERP 500' })
    expect(chamadas[0]!.update).toMatchObject({
      ok: false, erro: 'ERP 500', enviado_em: null, reservado_em: null,
    })
  })

  it('espera (aguardar): devolve a tentativa cobrada e adia a linha ~5 min, sem enviado_em', async () => {
    const { sb, chamadas } = sbFalso()
    const antes = Date.now()
    await criarRepositorioEstoqueEnvios(sb).concluirEnvio(
      { ...ENVIO, tentativas: 3 },
      { ok: false, erro: 'OP sem empenho suficiente no Compels.', aguardar: true },
    )
    const u = chamadas[0]!.update!
    expect(u).toMatchObject({ ok: false, erro: 'OP sem empenho suficiente no Compels.', enviado_em: null, tentativas: 2 })
    // 10 min no passado: a reserva só vence após 15 min, então a linha volta daqui a ~5 min
    const reservadoEm = new Date(String(u.reservado_em)).getTime()
    expect(antes - reservadoEm).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000)
    expect(antes - reservadoEm).toBeLessThan(10 * 60 * 1000 + 5000)
    // a cerca continua sendo a tentativa lida na reserva (3), não a devolvida
    expect(chamadas[0]!.filtros).toContainEqual(['tentativas', 3])
  })

  it('espera na primeira tentativa não deixa a contagem negativa', async () => {
    const { sb, chamadas } = sbFalso()
    await criarRepositorioEstoqueEnvios(sb).concluirEnvio(
      { ...ENVIO, tentativas: 0 },
      { ok: false, erro: 'x', aguardar: true },
    )
    expect(chamadas[0]!.update!.tentativas).toBe(0)
  })

  it('as três cercas da escrita: a linha, a tentativa desta reserva e o cancelamento no meio', async () => {
    // `tentativas` impede uma escrita atrasada de sobrescrever o resultado de outra rodada que já
    // re-reservou a linha. `cancelado_em is null` é exigência da 0132: o CHECK
    // (cancelado_em is null or not ok) estouraria na cara do servidor se um cancelamento caísse
    // entre a reserva e esta escrita.
    const { sb, chamadas } = sbFalso()
    await criarRepositorioEstoqueEnvios(sb).concluirEnvio(ENVIO, { ok: true })
    expect(chamadas[0]!.filtros).toEqual([['id', 'e1'], ['tentativas', 2], ['cancelado_em', null]])
  })

  it('zero linha afetada não é erro: avisa no log e segue (a rodada não cai)', async () => {
    const { sb } = sbFalso({ linhasAfetadas: () => 0 })
    const erros = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await criarRepositorioEstoqueEnvios(sb).concluirEnvio(ENVIO, { ok: true })
      expect(erros).toHaveBeenCalledOnce()
      expect(String(erros.mock.calls[0]![0])).toContain('resultado descartado')
    } finally {
      erros.mockRestore()
    }
  })

  it('erro gigante do ERP é aparado: a linha guarda o começo, que é onde está o motivo', async () => {
    const { sb, chamadas } = sbFalso()
    await criarRepositorioEstoqueEnvios(sb).concluirEnvio(ENVIO, { ok: false, erro: 'x'.repeat(2000) })
    expect(String(chamadas[0]!.update!.erro)).toHaveLength(500)
  })
})
