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

/**
 * Um intervalo como o BANCO entrega: `time` do Postgres chega 'HH:MM:SS' (às vezes com fração) no
 * PostgREST, e o resto do módulo fala 'HH:MM'. Linha ilegível (ou invertida) devolve null — quem
 * lê pula a linha em vez de inventar horário.
 *
 * Mora aqui, e não na infra, porque é este arquivo que define o formato 'HH:MM': os DOIS lados que
 * leem `alerta_regra_intervalos` (a tela do gestor e o cron) têm que converter do mesmo jeito, e
 * duas cópias da regra divergiriam em silêncio.
 */
export function lerIntervaloDoBanco(inicio: unknown, fim: unknown): Intervalo | null {
  const i = lerHhMm(typeof inicio === 'string' ? inicio.slice(0, 5) : inicio)
  const f = lerHhMm(typeof fim === 'string' ? fim.slice(0, 5) : fim)
  if (i === null || f === null || f <= i) return null
  return { inicio: formatarHhMm(i), fim: formatarHhMm(f) }
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

const FUSO = 'America/Sao_Paulo'

/**
 * Partes da data no fuso da fábrica, não no do processo. `hourCycle: 'h23'` fica declarado para
 * o dia nunca depender do ciclo de hora que o locale escolher (ver `deslocamentoMin`).
 */
export function partesSp(d: Date): { ano: number; mes: number; dia: number; hora: number; minuto: number } {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const achar = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
  return { ano: achar('year'), mes: achar('month'), dia: achar('day'), hora: achar('hour'), minuto: achar('minute') }
}

/**
 * Deslocamento do fuso da fábrica, em minutos, NAQUELE instante.
 * `hourCycle: 'h23'` é explícito (e NÃO `hour12: false`, que resolve para o ciclo 'h24' e devolve
 * hora 24 à meia-noite): a hora vem em 0–23 por declaração, não por sorte do ICU, então não há
 * nenhum `% 24` para emparelhar hora 24 com o dia certo. `hour12` sobrepõe `hourCycle` — não volte.
 */
function deslocamentoMin(d: Date): number {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const achar = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
  const comoUtc = Date.UTC(achar('year'), achar('month') - 1, achar('day'),
                           achar('hour'), achar('minute'), achar('second'))
  return (comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000
}

/**
 * O instante de uma hora de PAREDE da fábrica. Duas passadas: o deslocamento do palpite pode
 * diferir do deslocamento do instante correto numa fronteira de horário de verão. O Brasil não
 * tem horário de verão desde 2019, mas a conta não custa nada e não depende disso continuar.
 */
function instanteSp(ano: number, mes: number, dia: number, minutosDoDia: number): Date {
  const palpite = Date.UTC(ano, mes - 1, dia) + minutosDoDia * 60_000
  const d1 = deslocamentoMin(new Date(palpite))
  const corrigido = palpite - d1 * 60_000
  const d2 = deslocamentoMin(new Date(corrigido))
  return new Date(d2 === d1 ? corrigido : palpite - d2 * 60_000)
}

/**
 * O bloco mais recente que FECHOU HOJE (no dia da fábrica, em São Paulo), ou null se nenhum
 * fechou ainda. Os intervalos chegam já validados por `validarIntervalos`; lista vazia → null.
 */
export function blocoCandidato(intervalos: Intervalo[], passoMin: number, agora: Date): Bloco | null {
  // O passo é um número INTEIRO de minutos (vem de `janela_valor`, que é `int` no banco). Passo
  // fracionário ou menor que 1 devolve nulo em vez de ladrilhar: fração minúscula não avança o
  // `ini += passoMin` (o ulp de 420 já é 5.7e-14) e fração pequena ladrilharia milhões de blocos.
  if (!Number.isInteger(passoMin) || passoMin < 1) return null
  // Num cron, data inválida tem que pular o tique, não estourar RangeError dentro do Intl.
  if (Number.isNaN(agora.getTime())) return null

  const hoje = partesSp(agora)
  const limite = agora.getTime()
  let melhor: Bloco | null = null

  for (const intervalo of intervalos) {
    const i = lerHhMm(intervalo.inicio)
    const f = lerHhMm(intervalo.fim)
    if (i === null || f === null || f <= i) continue

    for (let ini = i; ini < f; ini += passoMin) {
      // O último bloco do intervalo termina no fim do intervalo, mesmo que seja mais curto.
      const fim = Math.min(ini + passoMin, f)
      const fimEm = instanteSp(hoje.ano, hoje.mes, hoje.dia, fim)
      // Dentro do intervalo os `fim` são monótonos: se este não fechou, nenhum dos seguintes fechou.
      if (fimEm.getTime() > limite) break
      if (melhor === null || fimEm.getTime() > melhor.fim.getTime()) {
        melhor = { inicio: instanteSp(hoje.ano, hoje.mes, hoje.dia, ini), fim: fimEm }
      }
    }
  }

  return melhor
}

/** A sobra do intervalo: o último bloco, quando o passo não fecha redondo. Null quando fecha. */
export function sobraDoIntervalo(intervalo: Intervalo, passoMin: number): Intervalo | null {
  // Mesma regra de `blocoCandidato`: minutos inteiros, no mínimo 1.
  if (!Number.isInteger(passoMin) || passoMin < 1) return null
  const i = lerHhMm(intervalo.inicio)
  const f = lerHhMm(intervalo.fim)
  if (i === null || f === null || f <= i) return null
  const resto = (f - i) % passoMin
  if (resto === 0) return null
  return { inicio: formatarHhMm(f - resto), fim: formatarHhMm(f) }
}
