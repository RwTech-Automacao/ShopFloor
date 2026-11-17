import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceSupabase } from '@/shared/lib/supabase/service'
import type { OsPlanilha } from '../domain/planilha'
import type { ContagemGravacao } from '../application/sincronizar-planilha'

/** O lote no formato da função `sat_sincronizar_planilha` (0186). */
export function loteParaBanco(lote: OsPlanilha[]): Record<string, unknown>[] {
  return lote.map((o) => ({
    chave: o.chave, numero: o.numero, data: o.data, tecnico: o.tecnico, cliente: o.cliente,
    equipamento: o.equipamento, garantia: o.garantia, primeiro_registro: o.primeiroRegistro, defeito: o.defeito,
    observacao: o.observacao, solucao: o.solucao, vendedor: o.vendedor, aba: o.aba, linha: o.linha,
    itens: o.itens.map((i) => ({
      chave: i.chave, ns: i.nsEscrito, modelo: i.modelo, sequencia: i.sequencia, codigo_peca: i.codigoPeca,
      peca: i.peca, quantidade: i.quantidade, data: i.data,
    })),
  }))
}

/** Grava um lote de OS com a service role (o cron não tem sessão). */
export function gravarOsDoServico(sb: SupabaseClient = createServiceSupabase()) {
  return async (lote: OsPlanilha[]): Promise<ContagemGravacao> => {
    const { data, error } = await sb.rpc('sat_sincronizar_planilha', { p_os: loteParaBanco(lote) })
    if (error) throw new Error(`gravar a planilha do SAT: ${error.message}`)
    return data as ContagemGravacao
  }
}
