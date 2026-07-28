import { normalizarSerie } from './serie'

/** Filtros da Tela de Registros. Todos opcionais; `snNorm` casa `numero_serie_norm`. */
export interface FiltrosRegistros {
  cliente?: string
  busca?: string // casa pmo OU op
  posto?: string
  snNorm?: string
  status?: string // 'aprovado' | 'reprovado' | 'sem-status'
  de?: string // data início (aplicada em data_hora)
  ate?: string // data fim
}

/** Interpreta os filtros crus (searchParams) num objeto validado; ignora vazios. */
export function parsearFiltrosRegistros(
  input: Record<string, string | undefined>,
): FiltrosRegistros {
  const f: FiltrosRegistros = {}
  const cliente = input.cliente?.trim()
  if (cliente) f.cliente = cliente
  const busca = input.busca?.trim()
  if (busca) f.busca = busca
  const posto = input.posto?.trim()
  if (posto) f.posto = posto
  const sn = input.sn?.trim()
  if (sn) {
    const norm = normalizarSerie(sn)
    if (norm) f.snNorm = norm
  }
  const status = input.status?.trim()
  if (status) f.status = status
  const de = input.de?.trim()
  if (de) f.de = de
  const ate = input.ate?.trim()
  if (ate) f.ate = ate
  return f
}
