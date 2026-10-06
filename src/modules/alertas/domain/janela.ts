import type { JanelaTipo } from './tipos'
import { formatarDuracao, formatarHora } from './mensagens'

export interface Janela {
  tipo: JanelaTipo
  /** Minutos (tipo `tempo`) ou quantidade de bipes (tipo `bipes`). Null no tipo `op`. */
  valor: number | null
  /** Só no tipo `op`: a OP em que a taxa foi medida. */
  pmo?: string | null
  op?: string | null
  /** Só no tipo `intervalos`: a faixa do bloco medido (ISO, como vem do jsonb de `alerta_envios.dados`). */
  blocoInicio?: string | null
  blocoFim?: string | null
}

/** Trecho da mensagem: "Taxa: 75,0% **na última hora** (mínimo 90%)". */
export function textoJanela(j: Janela): string {
  switch (j.tipo) {
    case 'tempo': {
      const min = j.valor ?? 60
      if (min === 60) return 'na última hora'
      if (min === 1) return 'no último minuto'
      return `nos últimos ${min} minutos`
    }
    case 'bipes': {
      const n = j.valor ?? 50
      return n === 1 ? 'no último bipe' : `nos últimos ${n} bipes`
    }
    case 'op':
      return j.pmo && j.op ? `na OP ${j.pmo}/${j.op}` : 'na OP em andamento'
    case 'intervalos': {
      const ini = j.blocoInicio ? new Date(j.blocoInicio) : null
      const fim = j.blocoFim ? new Date(j.blocoFim) : null
      if (!ini || !fim || Number.isNaN(ini.getTime()) || Number.isNaN(fim.getTime())) {
        return 'no bloco do turno'
      }
      return `das ${formatarHora(ini)} às ${formatarHora(fim)}`
    }
  }
}

/** Versão curta para a coluna "Janela" da tabela de regras. */
export function resumoJanela(j: { tipo: JanelaTipo; valor: number | null }): string {
  if (j.tipo === 'tempo') return `Últimos ${j.valor ?? 60} min`
  if (j.tipo === 'bipes') return `Últimos ${j.valor ?? 50} bipes`
  if (j.tipo === 'intervalos') return `Blocos de ${formatarDuracao((j.valor ?? 60) * 60_000)}`
  return 'OP em andamento'
}
