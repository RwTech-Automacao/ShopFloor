import { getSessao } from '@/modules/auth/application/get-sessao'
import { inserirLog } from '../infra/log-repository'

export type AcaoLog =
  | 'criar'
  | 'importar'
  | 'alterar_campo'
  | 'mudar_status'
  | 'gerar_etiqueta'
  | 'excluir'
  | 'login'

export async function registrarLog(input: {
  entidade: string
  entidadeId?: string
  acao: AcaoLog
  descricao: string
  dados?: unknown
}): Promise<void> {
  const sessao = await getSessao()
  if (!sessao) return
  await inserirLog({
    entidade: input.entidade,
    entidadeId: input.entidadeId ?? null,
    acao: input.acao,
    descricao: input.descricao,
    dados: input.dados,
    usuarioId: sessao.usuarioId,
    usuarioNome: sessao.nome || sessao.email,
  })
}
