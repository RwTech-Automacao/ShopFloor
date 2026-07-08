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
  aberto: 'bg-gray-100 text-gray-700',
  em_conferencia: 'bg-amber-100 text-amber-800',
  finalizado: 'bg-green-100 text-green-800',
  cancelado: 'bg-red-100 text-red-800',
}

const COR_PADRAO = 'bg-gray-100 text-gray-700'

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
