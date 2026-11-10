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
  shopfloor: ['aprovacao', 'tempo', 'defeito', 'resumo', 'parado', 'compels', 'ficha'],
  recebimento: ['emb'],
}

export function tipoPertenceAoModulo(tipo: TipoRegra, modulo: ModuloAlerta): boolean {
  return TIPOS_REGRA_POR_MODULO[modulo].includes(tipo)
}

/**
 * Tipos que continuam EXISTINDO (o avaliador roda, a regra salva aparece na lista e pode ser editada,
 * desativada e excluída, e o servidor aceita gravá-la) mas que a regra NOVA não oferece: o cartão some
 * da escolha do tipo. É a chave única para esconder um tipo por enquanto — esvaziar a lista religa.
 *
 * ⚠️ Não tire o tipo de `TIPOS_REGRA_POR_MODULO` para escondê-lo: `tipoPertenceAoModulo` passaria a
 * recusar a regra que já existe, e ela ficaria órfã (sem poder ser salva nem desativada pela tela).
 *
 * 'ficha' (Ficha de apontamento, 0173): escondida em 10/11/2026 a pedido do usuário.
 */
export const TIPOS_REGRA_OCULTOS_NA_CRIACAO: readonly TipoRegra[] = ['ficha']

/** Os tipos que a escolha da regra nova mostra: os do módulo, menos os ocultos. */
export function tiposOferecidosNaCriacao(
  modulo: ModuloAlerta,
  ocultos: readonly TipoRegra[] = TIPOS_REGRA_OCULTOS_NA_CRIACAO,
): readonly TipoRegra[] {
  return TIPOS_REGRA_POR_MODULO[modulo].filter((t) => !ocultos.includes(t))
}

/**
 * A rota da tela de Alertas de cada módulo. Duas rotas, um componente (spec, decisão 2): é a rota
 * que carrega o `modulo` e o RBAC do menu, não o componente.
 */
export const ROTA_ALERTAS: Record<ModuloAlerta, string> = {
  shopfloor: '/configuracoes/sf-alertas',
  recebimento: '/configuracoes/rec-alertas',
}
