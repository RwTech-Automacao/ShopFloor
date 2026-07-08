import { createServerSupabase } from '@/shared/lib/supabase/server'

export interface NovoLog {
  entidade: string
  entidadeId?: string | null
  acao: string
  descricao: string
  dados?: unknown
  usuarioId: string
  usuarioNome: string
}

export async function inserirLog(log: NovoLog): Promise<void> {
  const supabase = await createServerSupabase()
  const { error } = await supabase.from('logs').insert({
    entidade: log.entidade,
    entidade_id: log.entidadeId ?? null,
    acao: log.acao,
    descricao: log.descricao,
    dados: log.dados ?? {},
    usuario_id: log.usuarioId,
    usuario_nome: log.usuarioNome,
  })
  // Auditoria: falha de escrita de log não deve derrubar a ação de negócio,
  // mas nunca pode desaparecer silenciosamente.
  if (error) {
    console.error('[logs] falha ao inserir log', {
      entidade: log.entidade,
      acao: log.acao,
      error,
    })
  }
}
