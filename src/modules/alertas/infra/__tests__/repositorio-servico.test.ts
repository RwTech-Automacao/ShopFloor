import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EnvioReservado } from '../../domain/envio'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioServico } from '../repositorio-servico'

interface Chamada {
  tabela: string
  update?: Record<string, unknown>
  filtros: [string, unknown][]
  select?: string
}

/**
 * Supabase de mentira: grava cada `from(...).update(...).eq(...)` e devolve o que o teste mandar.
 * A "linha" do banco é simulada pelo teste via `linhasAfetadas` (a cerca de tentativas).
 */
function sbFalso(opcoes: {
  rpc?: (nome: string, args: Record<string, unknown>) => { data: unknown; error: { message: string } | null }
  linhasAfetadas?: (c: Chamada) => number
}) {
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
      select(cols: string) {
        c.select = cols
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
      return opcoes.rpc?.(nome, args) ?? { data: null, error: null }
    },
  } as unknown as SupabaseClient
  return { sb, chamadas, rpcs }
}

const ENVIO: EnvioReservado = {
  id: 'e1',
  ocorrenciaId: 'oc1',
  usuarioId: 'u1',
  canal: 'telegram',
  externoId: '111',
  tipo: 'resolvido',
  dados: {},
  comBotao: false,
  tentativas: 2,
}

describe('concluirEnvio — cerca de tentativas', () => {
  it('só atualiza a linha se `tentativas` ainda é a desta reserva', async () => {
    const { sb, chamadas } = sbFalso({})
    await criarRepositorioServico(sb).concluirEnvio(ENVIO, 'texto', { ok: true, mensagemExternaId: '111:9' })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.tabela).toBe('alerta_envios')
    expect(chamadas[0]!.filtros).toEqual([
      ['id', 'e1'],
      ['tentativas', 2],
    ])
    expect(chamadas[0]!.update).toMatchObject({ ok: true, mensagem_externa_id: '111:9', reservado_em: null })
  })

  it('linha re-reservada por outra rodada: não lança, só registra que descartou', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sb } = sbFalso({ linhasAfetadas: () => 0 })
    await expect(
      criarRepositorioServico(sb).concluirEnvio(ENVIO, 'texto', { ok: false, erro: 'Telegram 500' }),
    ).resolves.toBeUndefined()
    expect(erro.mock.calls.some((a) => String(a[0]).includes('descartado'))).toBe(true)
    erro.mockRestore()
  })
})

describe('reservarPendentes — linha ilegível', () => {
  it('conclui a linha rejeitada como falha (com cerca) e entrega só as boas', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boa = {
      id: 'e1',
      ocorrencia_id: 'oc1',
      usuario_id: 'u1',
      canal: 'telegram',
      externo_id: '111',
      tipo: 'resolvido',
      dados: {},
      com_botao: false,
      tentativas: 1,
    }
    const ruim = { ...boa, id: 'e2', canal: 'sms', tentativas: 3 }
    const { sb, chamadas } = sbFalso({ rpc: () => ({ data: [boa, ruim], error: null }) })

    const lote = await criarRepositorioServico(sb).reservarPendentes({
      canais: ['telegram'],
      limite: 30,
      ocorrenciaId: null,
    })

    expect(lote.map((e) => e.id)).toEqual(['e1'])
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.filtros).toEqual([
      ['id', 'e2'],
      ['tentativas', 3],
    ])
    expect(chamadas[0]!.update).toMatchObject({ ok: false, reservado_em: null })
    expect(String(chamadas[0]!.update!.erro)).toContain('ilegível')
    erro.mockRestore()
  })

  it('linha sem id não tem como ser concluída: só loga', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sb, chamadas } = sbFalso({ rpc: () => ({ data: [{ canal: 'sms' }], error: null }) })
    const lote = await criarRepositorioServico(sb).reservarPendentes({
      canais: ['telegram'],
      limite: 30,
      ocorrenciaId: null,
    })
    expect(lote).toEqual([])
    expect(chamadas).toHaveLength(0)
    erro.mockRestore()
  })
})

describe('vincular — contrato jsonb do alerta_vincular', () => {
  it('sucesso devolve o nome', async () => {
    const { sb, rpcs } = sbFalso({ rpc: () => ({ data: { ok: true, nome: 'Ana Gestora' }, error: null }) })
    const r = await criarRepositorioServico(sb).vincular('ALERTA-7K3M', 'discord', 'D9')
    expect(r).toEqual({ ok: true, nome: 'Ana Gestora' })
    expect(rpcs).toEqual([
      { nome: 'alerta_vincular', args: { p_codigo: 'ALERTA-7K3M', p_canal: 'discord', p_externo_id: 'D9' } },
    ])
  })

  it('MUITAS_TENTATIVAS vira mensagem amigável', async () => {
    const { sb } = sbFalso({ rpc: () => ({ data: { ok: false, erro: 'MUITAS_TENTATIVAS' }, error: null }) })
    const r = await criarRepositorioServico(sb).vincular('ALERTA-7K3M', 'telegram', '111')
    expect(r).toEqual({
      ok: false,
      erro: 'Muitas tentativas. Aguarde 15 minutos e gere um código novo no ShopFloor.',
    })
  })

  it('resposta vazia (data null, sem erro) vira falha genérica, sem estourar', async () => {
    const { sb } = sbFalso({ rpc: () => ({ data: null, error: null }) })
    const r = await criarRepositorioServico(sb).vincular('ALERTA-7K3M', 'telegram', '111')
    expect(r).toEqual({ ok: false, erro: 'Não foi possível concluir agora. Tente de novo.' })
  })

  it('erro de sistema não vaza texto do Postgres', async () => {
    const { sb } = sbFalso({ rpc: () => ({ data: null, error: { message: 'connection refused 10.0.0.5' } }) })
    const r = await criarRepositorioServico(sb).vincular('ALERTA-7K3M', 'telegram', '111')
    expect(r).toEqual({ ok: false, erro: 'Não foi possível concluir agora. Tente de novo.' })
  })
})

describe('resolver', () => {
  it('erro do Postgres vira código + mensagem', async () => {
    const { sb } = sbFalso({ rpc: () => ({ data: null, error: { message: 'NAO_DESTINATARIO' } }) })
    const r = await criarRepositorioServico(sb).resolver('oc1', 'u3')
    expect(r).toEqual({ ok: false, codigo: 'NAO_DESTINATARIO', erro: 'Você não é destinatário desta regra ou não administra o ShopFloor.' })
  })
})
