import { instanteSp, lerHhMm, partesSp, type Intervalo } from './intervalos'

/** Quanto do passado o cálculo olha: item parado há mais que isso já passou de qualquer limite. */
const DIAS_MAX = 400

const MINUTO_MS = 60_000

/**
 * Minutos de EXPEDIENTE entre dois instantes: só o que cai dentro dos turnos, só de segunda a sexta
 * (a semana da fábrica e do cron). Sem turno legível, conta relógio corrido — uma regra sem turno
 * cadastrado continua avisando, com a conta mais simples.
 *
 * Os turnos são horas de parede de São Paulo; cada dia é montado com `instanteSp`, nunca com o
 * fuso do processo. O dia da semana sai da data do calendário (`Date.UTC`), que não depende de fuso.
 */
export function minutosDeExpediente(de: Date, ate: Date, turnos: readonly Intervalo[]): number {
  const t0 = de.getTime()
  const t1 = ate.getTime()
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 <= t0) return 0

  const faixas: { ini: number; fim: number }[] = []
  for (const t of turnos) {
    const ini = lerHhMm(t.inicio)
    const fim = lerHhMm(t.fim)
    if (ini === null || fim === null || fim <= ini) continue
    faixas.push({ ini, fim })
  }
  if (faixas.length === 0) return Math.floor((t1 - t0) / MINUTO_MS)

  const inicio = Math.max(t0, t1 - DIAS_MAX * 24 * 60 * MINUTO_MS)
  const a = partesSp(new Date(inicio))
  const b = partesSp(new Date(t1))
  const ultimo = Date.UTC(b.ano, b.mes - 1, b.dia)

  let total = 0
  for (let dia = Date.UTC(a.ano, a.mes - 1, a.dia); dia <= ultimo; dia += 24 * 60 * MINUTO_MS) {
    const d = new Date(dia)
    const semana = d.getUTCDay()
    if (semana === 0 || semana === 6) continue
    const ano = d.getUTCFullYear()
    const mes = d.getUTCMonth() + 1
    const diaDoMes = d.getUTCDate()
    for (const f of faixas) {
      const ini = Math.max(instanteSp(ano, mes, diaDoMes, f.ini).getTime(), inicio)
      const fim = Math.min(instanteSp(ano, mes, diaDoMes, f.fim).getTime(), t1)
      if (fim > ini) total += (fim - ini) / MINUTO_MS
    }
  }
  return Math.floor(total)
}
