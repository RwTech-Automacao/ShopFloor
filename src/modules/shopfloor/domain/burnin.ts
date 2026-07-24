export interface RegistroBurnin {
  dataHora: string
  status: string // '' = entrada; 'Aprovado'/'Reprovado' = saída
}

export interface CicloBurnin {
  entrada: string
  saida: string | null
  status: string
  duracaoMin: number | null
}

/** Pareia entrada↔saída em ordem cronológica. Entrada com ciclo aberto e saída órfã são ignoradas. */
export function pareaBurnin(registros: RegistroBurnin[]): CicloBurnin[] {
  const ordenados = [...registros].sort((a, b) => a.dataHora.localeCompare(b.dataHora))
  const ciclos: CicloBurnin[] = []
  let aberto: CicloBurnin | null = null
  for (const reg of ordenados) {
    const ehEntrada = reg.status.trim() === ''
    if (ehEntrada) {
      if (!aberto) {
        aberto = { entrada: reg.dataHora, saida: null, status: '', duracaoMin: null }
        ciclos.push(aberto)
      }
    } else if (aberto) {
      aberto.saida = reg.dataHora
      aberto.status = reg.status
      aberto.duracaoMin = Math.max(0, Math.round((Date.parse(reg.dataHora) - Date.parse(aberto.entrada)) / 60000))
      aberto = null
    }
  }
  return ciclos
}

export function estaAberto(ciclos: CicloBurnin[]): boolean {
  const ultimo = ciclos[ciclos.length - 1]
  return ultimo !== undefined && ultimo.saida === null
}

/** minutos → "6h30". Para tempo decorrido, passe (agora − entrada) em minutos. */
export function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}h${String(m).padStart(2, '0')}`
}
