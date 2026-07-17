/**
 * Classe do trigger de um menu de coluna quando exibido como "chip" (pílula) na barra
 * de filtros dos cards de mobile/tablet. Compartilhado pelo grid de Processos e pelo de
 * Etiquetas para que os dois não divirjam. `ativo` = a coluna tem filtro; `ordenando` =
 * é a coluna pela qual a lista está ordenada (ambos destacam o chip em vinho).
 */
export function classeChipTrigger(ativo: boolean, ordenando: boolean): string {
  return `inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] ${
    ativo || ordenando
      ? 'border-enterplak bg-enterplak-50 text-enterplak'
      : 'border-border hover:bg-muted'
  }`
}
