import type { Modulo, Permissao, PermissaoLegada } from '@/modules/auth/domain/perfil'

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
  { chave: 'baixar', rotulo: 'Baixar NF' },
  { chave: 'registrar_entrada', rotulo: 'Registrar entrada' },
  { chave: 'aprovar_nf', rotulo: 'Aprovar NF' },
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

/** Módulos cujas permissões NÃO ligam as colunas antigas `pode_*` do perfil. */
export const MODULOS_SEM_FLAG_LEGADA: Modulo[] = ['vitrine', 'faturamento', 'sat']

/**
 * As colunas `pode_*` do perfil (derivadas, usadas pelo RLS antigo): cada uma é true se a permissão foi
 * concedida em QUALQUER módulo — menos os de `MODULOS_SEM_FLAG_LEGADA`. A Vitrine não lê o banco, e as
 * regras de 1 argumento (`tem_permissao('visualizar')`) olham estas flags: se `vitrine.visualizar`
 * ligasse `pode_visualizar`, o perfil do marketing passaria a ler dados reais direto pela API. O Faturamento
 * (só a baixa de NF) pela mesma razão: `faturamento.visualizar` não pode abrir as tabelas do ShopFloor e do
 * Recebimento. O SAT idem: `sat.visualizar`/`sat.administrar` abririam leitura e escrita nas tabelas antigas.
 * `baixar`, `registrar_entrada` e `aprovar_nf` não têm coluna — nunca viram flag.
 */
export function flagsLegadas(grants: { modulo: Modulo; permissao: Permissao }[]): Record<`pode_${PermissaoLegada}`, boolean> {
  const concedida = (p: PermissaoLegada) => grants.some((g) => g.permissao === p && !MODULOS_SEM_FLAG_LEGADA.includes(g.modulo))
  return {
    pode_visualizar: concedida('visualizar'),
    pode_importar: concedida('importar'),
    pode_editar: concedida('editar'),
    pode_finalizar: concedida('finalizar'),
    pode_editar_finalizado: concedida('editar_finalizado'),
    pode_excluir: concedida('excluir'),
    pode_gerar_etiqueta: concedida('gerar_etiqueta'),
    pode_administrar: concedida('administrar'),
    pode_lancar: concedida('lancar'),
  }
}
