export type Processo = 'SMD' | 'PTH'
export type EstadoSetup = 'montagem' | 'liberado'

/** No PTH as colunas posicao/feeder guardam posto/locação. */
export function rotulosPosicao(processo: Processo): { posicao: string; feeder: string; equipamento: string } {
  return processo === 'PTH'
    ? { posicao: 'Posto', feeder: 'Locação', equipamento: 'Bloco' }
    : { posicao: 'Posição', feeder: 'Feeder', equipamento: 'Máquina' }
}
