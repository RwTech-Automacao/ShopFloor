import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('server-only', () => ({}))
vi.mock('@/shared/lib/supabase/service', () => ({ createServiceSupabase: () => null }))

import { criarRepositorioServico } from '../repositorio-servico'

/** Supabase de mentira: a reserva devolve `linhas`; `alerta_ocorrencias` devolve `ocorrencias` (ou o erro). */
function sbFalso(linhas: unknown[], ocorrencias: unknown[] | { erro: string }) {
  const consultas: { tabela: string; filtros: [string, unknown][] }[] = []
  const sb = {
    from(tabela: string) {
      const c = { tabela, filtros: [] as [string, unknown][] }
      consultas.push(c)
      const q = {
        select: () => q,
        in(col: string, v: unknown) { c.filtros.push([col, v]); return q },
        then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
          const r = Array.isArray(ocorrencias)
            ? { data: ocorrencias, error: null }
            : { data: null, error: { message: ocorrencias.erro } }
          return Promise.resolve(r).then(ok, erro)
        },
      }
      return q
    },
    async rpc() { return { data: linhas, error: null } },
  } as unknown as SupabaseClient
  return { sb, consultas }
}

const linha = (id: string, tipo: string, dados: Record<string, unknown>, ocorrencia: string | null = `oc-${id}`) => ({
  id, ocorrencia_id: ocorrencia, usuario_id: 'u1', canal: 'telegram', externo_id: '111',
  tipo, dados, com_botao: true, tentativas: 1,
})

const FILTRO = { canais: ['telegram' as const], limite: 30, ocorrenciaId: null }

describe('reservarPendentes — regra_id do parado (link do relatório)', () => {
  it('acrescenta regra_id só nas linhas de alerta/lembrete do parado, numa leitura só', async () => {
    const { sb, consultas } = sbFalso(
      [
        linha('e1', 'alerta', { regra_tipo: 'parado' }),
        linha('e2', 'lembrete', { regra_tipo: 'parado' }),
        linha('e3', 'alerta', { regra_tipo: 'aprovacao' }),
        linha('e4', 'normalizou', { regra_tipo: 'parado' }),
      ],
      [{ id: 'oc-e1', regra_id: 'r1' }, { id: 'oc-e2', regra_id: 'r2' }],
    )
    const lote = await criarRepositorioServico(sb).reservarPendentes(FILTRO)
    expect(lote.map((e) => e.dados.regra_id ?? null)).toEqual(['r1', 'r2', null, null])
    expect(consultas).toEqual([{ tabela: 'alerta_ocorrencias', filtros: [['id', ['oc-e1', 'oc-e2']]] }])
  })

  it('sem parado no lote: nenhuma leitura a mais', async () => {
    const { sb, consultas } = sbFalso([linha('e1', 'alerta', { regra_tipo: 'tempo' })], [])
    await criarRepositorioServico(sb).reservarPendentes(FILTRO)
    expect(consultas).toHaveLength(0)
  })

  it('a leitura falhou: as linhas seguem sem link (a entrega não para)', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { sb } = sbFalso([linha('e1', 'alerta', { regra_tipo: 'parado' })], { erro: 'rede' })
    const lote = await criarRepositorioServico(sb).reservarPendentes(FILTRO)
    expect(lote).toHaveLength(1)
    expect(lote[0]!.dados.regra_id).toBeUndefined()
    expect(erro.mock.calls.some((a) => String(a[0]).includes('sai sem link'))).toBe(true)
    erro.mockRestore()
  })
})
