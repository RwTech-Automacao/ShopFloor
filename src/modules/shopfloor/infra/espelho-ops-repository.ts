import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServerSupabase } from '@/shared/lib/supabase/server'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { OpEspelho, OpEspelhoLida } from '@/modules/compels/domain/espelho-ops'
import type { ContagemEspelho } from '@/modules/compels/application/sincronizar-espelho-ops'

/** Grava a rodada pela sf_compels_ops_sincronizar (0184). Só o cron chama, com a service role. */
export function gravarEspelhoDoServico(sb: SupabaseClient = createServiceSupabase()) {
  return async (ops: OpEspelhoLida[]): Promise<ContagemEspelho> => {
    const { data, error } = await sb.rpc('sf_compels_ops_sincronizar', {
      p_ops: ops.map((o) => ({
        numero: o.numero, id_compels: o.idCompels, codigo: o.codigo, descricao: o.descricao, situacao: o.situacao,
        nivel: o.nivel, quantidade: o.quantidade, quantidade_produzida: o.quantidadeProduzida, mae_numero: o.maeNumero,
        principal_numero: o.principalNumero, cliente: o.cliente, data_documento: o.dataDocumento,
      })),
    })
    if (error) throw new Error(`gravar o espelho do Compels: ${error.message}`)
    return data as ContagemEspelho
  }
}

interface Linha {
  numero: number; id_compels: number; codigo: string; descricao: string; situacao: string; nivel: number
  quantidade: number | string; quantidade_produzida: number | string; mae_numero: number | null
  principal_numero: number | null; cliente: string; data_documento: string | null; ativa: boolean; lido_em: string
}

/** O espelho inteiro (ativas e as que já saíram da lista), pela sessão (RLS: shopfloor.administrar). */
export async function listarEspelho(): Promise<OpEspelho[]> {
  const sb = await createServerSupabase()
  const { data, error } = await sb.from('sf_compels_ops').select('*').order('numero')
  if (error) throw new Error(`sf_compels_ops: ${error.message}`)
  return ((data ?? []) as Linha[]).map((l) => ({
    numero: l.numero, idCompels: l.id_compels, codigo: l.codigo, descricao: l.descricao, situacao: l.situacao,
    nivel: l.nivel, quantidade: Number(l.quantidade), quantidadeProduzida: Number(l.quantidade_produzida),
    maeNumero: l.mae_numero, principalNumero: l.principal_numero, cliente: l.cliente, dataDocumento: l.data_documento,
    ativa: l.ativa, lidoEm: l.lido_em,
  }))
}
