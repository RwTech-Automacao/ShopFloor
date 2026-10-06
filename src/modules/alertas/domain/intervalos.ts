import { formatarDuracao } from './mensagens'

/** Um intervalo do turno: 'HH:MM', hora local da fábrica. */
export interface Intervalo {
  inicio: string
  fim: string
}

/** Um bloco já posto no calendário (instantes reais). */
export interface Bloco {
  inicio: Date
  fim: Date
}

export const PASSO_MIN_MINUTOS = 15
export const INTERVALO_MIN_MINUTOS = 15

type Resultado<T> = { ok: true; valor: T } | { ok: false; erro: string }

const RE_HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/

function erro(mensagem: string): { ok: false; erro: string } {
  return { ok: false, erro: mensagem }
}

/** 'HH:MM' (exatamente 2 dígitos de cada lado) → minutos desde 00:00; qualquer outra coisa → null. */
export function lerHhMm(texto: unknown): number | null {
  if (typeof texto !== 'string') return null
  const m = RE_HH_MM.exec(texto)
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

export function formatarHhMm(minutosDoDia: number): string {
  const h = Math.floor(minutosDoDia / 60)
  const m = minutosDoDia % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function nomeIntervalo(i: { ini: number; fim: number }): string {
  return `${formatarHhMm(i.ini)}–${formatarHhMm(i.fim)}`
}

/**
 * Confere os intervalos do turno e devolve-os aparados, sem duplicata e ORDENADOS pelo início.
 * `passoMin` null = o formulário ainda não preencheu: confere só os intervalos.
 */
export function validarIntervalos(lista: unknown, passoMin: number | null): Resultado<Intervalo[]> {
  if (!Array.isArray(lista) || lista.length === 0) return erro('Cadastre pelo menos 1 intervalo de horário.')

  const vistos = new Set<string>()
  const itens: { ini: number; fim: number }[] = []
  for (const bruto of lista) {
    const o = (typeof bruto === 'object' && bruto !== null ? bruto : {}) as Record<string, unknown>
    const ini = lerHhMm(typeof o.inicio === 'string' ? o.inicio.trim() : o.inicio)
    const fim = lerHhMm(typeof o.fim === 'string' ? o.fim.trim() : o.fim)
    if (ini === null || fim === null) return erro('Informe os horários no formato HH:MM (ex.: 07:00).')
    if (fim <= ini) {
      return erro('O horário final precisa ser maior que o inicial. Turno que passa da meia-noite não é suportado.')
    }
    if (fim - ini < INTERVALO_MIN_MINUTOS) {
      return erro(`Cada intervalo precisa ter no mínimo ${INTERVALO_MIN_MINUTOS} minutos.`)
    }
    const chave = `${ini}-${fim}`
    if (vistos.has(chave)) continue
    vistos.add(chave)
    itens.push({ ini, fim })
  }

  itens.sort((a, b) => a.ini - b.ini || a.fim - b.fim)

  for (let i = 1; i < itens.length; i++) {
    const anterior = itens[i - 1]!
    const atual = itens[i]!
    if (atual.ini < anterior.fim) {
      return erro(`Os intervalos ${nomeIntervalo(anterior)} e ${nomeIntervalo(atual)} se sobrepõem.`)
    }
  }

  if (passoMin !== null) {
    if (!Number.isFinite(passoMin) || passoMin < PASSO_MIN_MINUTOS) {
      return erro(`O passo precisa ter no mínimo ${PASSO_MIN_MINUTOS} minutos.`)
    }
    // Menor intervalo: em empate, o primeiro na ordem do dia.
    const menor = itens.reduce((a, b) => (b.fim - b.ini < a.fim - a.ini ? b : a))
    if (passoMin > menor.fim - menor.ini) {
      return erro(
        `O passo (${formatarDuracao(passoMin * 60_000)}) não cabe no menor intervalo cadastrado ` +
          `(${nomeIntervalo(menor)}, ${formatarDuracao((menor.fim - menor.ini) * 60_000)}).`,
      )
    }
  }

  return { ok: true, valor: itens.map((i) => ({ inicio: formatarHhMm(i.ini), fim: formatarHhMm(i.fim) })) }
}
