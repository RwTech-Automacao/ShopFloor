export type Processo = 'SMD' | 'PTH'
export type EstadoSetup = 'montagem' | 'liberado'

/** No PTH as colunas posicao/feeder guardam posto/locação. */
export function rotulosPosicao(processo: Processo): { posicao: string; feeder: string; equipamento: string } {
  return processo === 'PTH'
    ? { posicao: 'Posto', feeder: 'Locação', equipamento: 'Bloco' }
    : { posicao: 'Posição', feeder: 'Feeder', equipamento: 'Máquina' }
}

/** Equipamento em uma linha de texto: "Bloco A · MG5" no SMD, "Bloco A" no PTH (que não tem máquina).
 * Única cópia da regra — telas, CSV e logs chamam esta função. A linha não entra aqui: quem mostra
 * o equipamento junto da linha já escreve "Linha 1 · Bloco A · MG5". */
export function rotuloEquipamento(e: { processo: Processo; bloco: string; maquina: string | null }): string {
  return e.processo === 'SMD' && e.maquina ? `Bloco ${e.bloco} · ${e.maquina}` : `Bloco ${e.bloco}`
}
