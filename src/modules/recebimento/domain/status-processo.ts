export interface StatusProcessoInfo {
  rotulo: string
  className: string
}

const ROTULOS: Record<string, string> = {
  aberto: 'Aberto',
  em_conferencia: 'Em conferência',
  finalizado: 'Finalizado',
  cancelado: 'Cancelado',
}

const CORES: Record<string, string> = {
  aberto: 'bg-slate-50 text-slate-600 ring-1 ring-slate-500/25',
  em_conferencia: 'bg-amber-50 text-amber-700 ring-1 ring-amber-600/30',
  finalizado: 'bg-green-50 text-green-700 ring-1 ring-green-600/30',
  cancelado: 'bg-red-50 text-red-700 ring-1 ring-red-600/30',
}

const COR_PADRAO = 'bg-slate-50 text-slate-600 ring-1 ring-slate-500/25'

/**
 * Rótulo em pt-BR e classes Tailwind (fundo/texto) para o status de um
 * processo de recebimento. Status desconhecidos caem no rótulo bruto com
 * cor neutra, para não quebrar a tela caso o banco ganhe um valor novo.
 */
export function rotuloStatusProcesso(status: string): StatusProcessoInfo {
  return {
    rotulo: ROTULOS[status] ?? status,
    className: CORES[status] ?? COR_PADRAO,
  }
}
