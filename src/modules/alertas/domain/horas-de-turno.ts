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
  const DIA_MS = 24 * 60 * MINUTO_MS
  // Meia-noite de parede de SP do dia seguinte vira a do dia seguinte da volta: 1 conversão por dia.
  let meiaNoite: number | null = null
  for (let dia = Date.UTC(a.ano, a.mes - 1, a.dia); dia <= ultimo; dia += DIA_MS) {
    const d = new Date(dia)
    const ano = d.getUTCFullYear()
    const mes = d.getUTCMonth() + 1
    const diaDoMes = d.getUTCDate()
    const hoje = meiaNoite ?? instanteSp(ano, mes, diaDoMes, 0).getTime()
    const amanha = new Date(dia + DIA_MS)
    meiaNoite = instanteSp(amanha.getUTCFullYear(), amanha.getUTCMonth() + 1, amanha.getUTCDate(), 0).getTime()
    const semana = d.getUTCDay()
    if (semana === 0 || semana === 6) continue
    // Dia de 24 h exatas (sem troca de horário dentro dele): hora de parede = meia-noite + minutos.
    // Se um dia não tiver 24 h (horário de verão, antes de 2019), converte cada hora de parede.
    const diaNormal = meiaNoite - hoje === DIA_MS
    for (const f of faixas) {
      const iniDia = diaNormal ? hoje + f.ini * MINUTO_MS : instanteSp(ano, mes, diaDoMes, f.ini).getTime()
      const fimDia = diaNormal ? hoje + f.fim * MINUTO_MS : instanteSp(ano, mes, diaDoMes, f.fim).getTime()
      const ini = Math.max(iniDia, inicio)
      const fim = Math.min(fimDia, t1)
      if (fim > ini) total += (fim - ini) / MINUTO_MS
    }
  }
  return Math.floor(total)
}

/** Segunda a sexta no calendário de São Paulo (o dia da semana sai da data de parede, não do fuso do processo). */
export function ehDiaUtilSp(d: Date): boolean {
  const p = partesSp(d)
  const semana = new Date(Date.UTC(p.ano, p.mes - 1, p.dia)).getUTCDay()
  return semana !== 0 && semana !== 6
}

/**
 * O instante MAIS RECENTE `T` tal que `minutosDeExpediente(T, agora, turnos) >= limiteMin`: quem ficou
 * parado desde `T` (ou antes) já passou do limite. A conta é monotônica (quanto mais antigo o
 * instante, mais minutos), então uma busca binária acha o corte; o banco filtra por `data_hora <= corte`
 * e a conta de expediente continua morando só aqui. Sem turno legível é relógio corrido: `agora - limite`.
 * Se nem a janela inteira do cálculo (400 dias) chega ao limite, devolve o início dela.
 */
export function corteDeExpediente(agora: Date, limiteMin: number, turnos: readonly Intervalo[]): Date {
  const fim = agora.getTime()
  const direto = fim - limiteMin * MINUTO_MS
  const temTurno = turnos.some((t) => {
    const ini = lerHhMm(t.inicio)
    const f = lerHhMm(t.fim)
    return ini !== null && f !== null && f > ini
  })
  if (!temTurno) return new Date(direto)
  const maisAntigo = fim - DIAS_MAX * 24 * 60 * MINUTO_MS
  if (minutosDeExpediente(new Date(maisAntigo), agora, turnos) < limiteMin) return new Date(maisAntigo)
  // Invariante: `lo` atinge o limite. Procura o maior instante (em minutos inteiros) que ainda atinge;
  // o expediente é no máximo o relógio, então o corte nunca passa de `agora - limite`.
  let lo = Math.floor(maisAntigo / MINUTO_MS)
  let hi = Math.floor(direto / MINUTO_MS)
  while (lo < hi) {
    const meio = Math.ceil((lo + hi) / 2)
    if (minutosDeExpediente(new Date(meio * MINUTO_MS), agora, turnos) >= limiteMin) lo = meio
    else hi = meio - 1
  }
  return new Date(lo * MINUTO_MS)
}
