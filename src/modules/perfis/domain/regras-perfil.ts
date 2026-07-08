import type { Permissao } from '@/modules/auth/domain/perfil'

export const PERMISSOES: { chave: Permissao; rotulo: string }[] = [
  { chave: 'visualizar', rotulo: 'Visualizar' },
  { chave: 'importar', rotulo: 'Importar' },
  { chave: 'editar', rotulo: 'Editar' },
  { chave: 'finalizar', rotulo: 'Finalizar' },
  { chave: 'editar_finalizado', rotulo: 'Editar finalizado' },
  { chave: 'excluir', rotulo: 'Excluir' },
  { chave: 'gerar_etiqueta', rotulo: 'Gerar etiqueta' },
  { chave: 'administrar', rotulo: 'Administrar' },
]

export function validarEdicaoPerfil(input: {
  perfilAlvoId: string
  perfilDoUsuarioId: string
  administrarNasNovasFlags: boolean
}): { ok: true } | { ok: false; erro: string } {
  if (
    input.perfilAlvoId === input.perfilDoUsuarioId &&
    !input.administrarNasNovasFlags
  ) {
    return {
      ok: false,
      erro: 'Você não pode remover a permissão Administrar do seu próprio perfil.',
    }
  }
  return { ok: true }
}
