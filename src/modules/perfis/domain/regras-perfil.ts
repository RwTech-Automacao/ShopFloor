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
  { chave: 'lancar', rotulo: 'Lançar' },
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

/**
 * O que sobra no banco depois de gravar os grants desejados: as permissões que o perfil TEM e que
 * a tela desmarcou. Agrupado por módulo (uma remoção por módulo, com a lista de permissões).
 *
 * Existe para a sincronização nunca apagar tudo e regravar: a regra de segurança do banco exige
 * `sistema.administrar` para gravar em `perfil_permissao`, e quem editava o PRÓPRIO perfil perdia essa
 * permissão no apagamento e ficava sem poder regravar nada (19/10/2026).
 */
export function grantsParaRemover(
  atuais: readonly { modulo: string; permissao: string }[],
  desejados: readonly { modulo: string; permissao: string }[],
): [modulo: string, permissoes: string[]][] {
  const querer = new Set(desejados.map((g) => `${g.modulo}\u0000${g.permissao}`))
  const porModulo = new Map<string, string[]>()
  for (const g of atuais) {
    if (querer.has(`${g.modulo}\u0000${g.permissao}`)) continue
    porModulo.set(g.modulo, [...(porModulo.get(g.modulo) ?? []), g.permissao])
  }
  return [...porModulo.entries()]
}
