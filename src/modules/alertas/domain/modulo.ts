import type { TipoRegra } from './tipos'

/**
 * Os módulos que têm alertas. NÃO é o `Modulo` do RBAC (`auth/domain/perfil`), que tem quatro
 * valores: aqui só entram os módulos com tela de Alertas, e é por isso que o tipo é próprio — um
 * `modulo: 'setup'` numa regra não quer dizer nada e não deve nem compilar.
 *
 * ⚠️ Os valores são os MESMOS do `Modulo` do RBAC de propósito: eles vão direto para
 * `podeNoModulo(perfil, modulo, 'administrar')` e para `tem_permissao(modulo, 'administrar')` no
 * banco. Renomear um aqui quebraria a permissão em silêncio.
 */
export type ModuloAlerta = 'shopfloor' | 'recebimento'

export const MODULOS_ALERTA: readonly ModuloAlerta[] = ['shopfloor', 'recebimento']

export function ehModuloAlerta(valor: unknown): valor is ModuloAlerta {
  return valor === 'shopfloor' || valor === 'recebimento'
}

/** Como o módulo é chamado na tela (cabeçalho da página, mensagens de erro). */
export const NOME_MODULO_ALERTA: Record<ModuloAlerta, string> = {
  shopfloor: 'Fluxo de Processos',
  recebimento: 'Recebimento',
}

/**
 * Quais tipos de regra cada módulo oferece. É daqui que sai a escolha de tipo (os cartões) e a
 * recusa do servidor quando o tipo não é do módulo: uma regra de "Taxa de aprovação" no Recebimento
 * mediria postos que o Recebimento não tem.
 *
 * ⚠️ Cada tipo pertence a UM módulo só, e o teste de `modulo.test.ts` cobra a cobertura completa de
 * `TIPOS_REGRA`: tipo novo sem módulo derruba o teste em vez de aparecer nas duas telas.
 *
 * O Recebimento tem UM tipo, o fim de EMB (0150). O check `alerta_regras_modulo_tipo` cobra o mesmo
 * no banco: `recebimento -> tipo in ('emb')`.
 */
export const TIPOS_REGRA_POR_MODULO: Record<ModuloAlerta, readonly TipoRegra[]> = {
  shopfloor: ['aprovacao', 'tempo', 'defeito', 'resumo', 'parado'],
  recebimento: ['emb'],
}

export function tipoPertenceAoModulo(tipo: TipoRegra, modulo: ModuloAlerta): boolean {
  return TIPOS_REGRA_POR_MODULO[modulo].includes(tipo)
}

/**
 * A rota da tela de Alertas de cada módulo. Duas rotas, um componente (spec, decisão 2): é a rota
 * que carrega o `modulo` e o RBAC do menu, não o componente.
 */
export const ROTA_ALERTAS: Record<ModuloAlerta, string> = {
  shopfloor: '/configuracoes/sf-alertas',
  recebimento: '/configuracoes/rec-alertas',
}
