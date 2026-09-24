import { ehEtapa, type Etapa } from './etapa-processo'

/** Opções de "quantos por página" da tela de Registros do Recebimento. Fica no domínio (e não no
 *  componente cliente) porque a página é Server Component: importar um valor de módulo 'use client'
 *  devolve uma referência, não o array — e chamar .includes() nela quebra o render no servidor. */
export const TAMANHOS_PAGINA = ['100', '250', '500'] as const

/** Filtros da tela de Registros do Recebimento. Todos opcionais. */
export interface FiltrosRegistrosRecebimento {
  emb?: string
  /** Código do material (casa por "contém"). */
  item?: string
  fornecedor?: string
  /** Caixa em que o item ficou depois do registro. */
  etapa?: Etapa
  de?: string // data início (aplicada em logs.created_at)
  ate?: string // data fim
  /** Nome do colaborador do log (casa por "contém"). */
  colaborador?: string
}

/** Interpreta os filtros crus (searchParams) num objeto validado; ignora vazios e valor inválido. */
export function parsearFiltrosRegistros(
  input: Record<string, string | undefined>,
): FiltrosRegistrosRecebimento {
  const f: FiltrosRegistrosRecebimento = {}
  const emb = input.emb?.trim()
  if (emb) f.emb = emb
  const item = input.item?.trim()
  if (item) f.item = item
  const fornecedor = input.fornecedor?.trim()
  if (fornecedor) f.fornecedor = fornecedor
  const etapa = input.etapa?.trim()
  if (etapa && ehEtapa(etapa)) f.etapa = etapa
  const colaborador = input.colaborador?.trim()
  if (colaborador) f.colaborador = colaborador
  // `logs.created_at` é timestamptz; ancoramos as datas só-data em BRT (UTC-3, sem horário de verão
  // desde 2019). Sem o fuso, o Postgres leria como UTC e a janela deslizaria ~3h (perderia
  // registros do fim do dia local).
  const de = input.de?.trim()
  if (de) f.de = de.length === 10 ? `${de}T00:00:00-03:00` : de
  const ate = input.ate?.trim()
  if (ate) f.ate = ate.length === 10 ? `${ate}T23:59:59.999-03:00` : ate
  return f
}
