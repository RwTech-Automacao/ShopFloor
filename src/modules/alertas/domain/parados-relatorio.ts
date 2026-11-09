import { minutosDeExpediente } from './horas-de-turno'
import { lerIntervaloDoBanco, type Intervalo } from './intervalos'
import { paradosPorOp, type GrupoTravado, type ParadosDaOp } from './parados'

/**
 * A tela "Peças paradas" (/shopfloor/analisar/parados): o estado de AGORA, SN a SN (sf_pecas_paradas, 0180, o
 * mesmo miolo da alerta_travados). A regra do link da mensagem (alerta_parado_regra, 0177) só preenche os
 * filtros (parados-filtros.ts). A conta de expediente e o agrupamento por OP são os do alerta
 * (`corteDeExpediente`, `minutosDeExpediente`, `paradosPorOp`).
 */

/** A regra como `alerta_parado_regra` (0177) a devolve, já lida. */
export interface RegraDoRelatorio {
  id: string
  nome: string
  limiteHoras: number
  postos: string[]
  pmos: string[]
  soOpsAtivas: boolean
  incluirManutencao: boolean
  ativa: boolean
  turnos: Intervalo[]
}

/** Uma peça parada, como `alerta_parado_sns` (0177) a devolve. */
export interface SnParado {
  pmo: string
  op: string
  posto: string
  /** O último registro é uma reprova: aguarda conserto/Manutenção. */
  reprovada: boolean
  numeroSerie: string
  /** O peso do bipe (placas por painel, 0161). */
  pecas: number
  /** O último registro da peça. */
  em: Date
}

export interface SnParadoComIdade extends SnParado {
  /** Minutos parada (de expediente, se a regra tem turno; senão relógio corrido). */
  minutos: number
}

export interface OpDoRelatorio extends ParadosDaOp {
  pecas: number
  /** As peças da OP, da mais antiga para a mais nova. */
  sns: SnParadoComIdade[]
}

export interface RelatorioParados {
  totalPecas: number
  expediente: boolean
  /** Da OP com a peça mais antiga para a mais nova (a ordem da mensagem). */
  ops: OpDoRelatorio[]
}

type Resultado<T> = { ok: true; valor: T } | { ok: false; motivo: 'regra_inexistente' | 'resposta_ilegivel' }

const textos = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Lê o jsonb de `alerta_parado_regra`. {ok:false, motivo} do banco vira o motivo; formato estranho é ilegível. */
export function lerRegraDoRelatorio(bruto: unknown): Resultado<RegraDoRelatorio> {
  if (bruto === null || typeof bruto !== 'object' || Array.isArray(bruto)) return { ok: false, motivo: 'resposta_ilegivel' }
  const r = bruto as Record<string, unknown>
  if (r.ok !== true) return { ok: false, motivo: r.motivo === 'regra_inexistente' ? 'regra_inexistente' : 'resposta_ilegivel' }
  const g = r.regra
  if (g === null || typeof g !== 'object' || Array.isArray(g)) return { ok: false, motivo: 'resposta_ilegivel' }
  const regra = g as Record<string, unknown>
  const limite = regra.limite_horas
  if (typeof regra.id !== 'string' || typeof limite !== 'number' || !Number.isInteger(limite) || limite < 1) {
    return { ok: false, motivo: 'resposta_ilegivel' }
  }
  const turnos: Intervalo[] = []
  for (const t of Array.isArray(r.turnos) ? r.turnos : []) {
    if (t === null || typeof t !== 'object') continue
    const i = lerIntervaloDoBanco((t as Record<string, unknown>).inicio, (t as Record<string, unknown>).fim)
    if (i) turnos.push(i)
  }
  return {
    ok: true,
    valor: {
      id: regra.id,
      nome: typeof regra.nome === 'string' ? regra.nome : '',
      limiteHoras: limite,
      postos: textos(regra.postos),
      pmos: textos(regra.pmos),
      // Como o avaliador: só `false` desliga (nulo vale o padrão, true).
      soOpsAtivas: regra.so_ops_ativas !== false,
      incluirManutencao: regra.incluir_manutencao !== false,
      ativa: regra.ativa === true,
      turnos,
    },
  }
}

/** Lê as linhas de `alerta_parado_sns`. Linha sem PMO, OP, posto ou data legível é descartada. */
export function lerSnsParados(linhas: unknown): SnParado[] {
  const saida: SnParado[] = []
  for (const bruto of Array.isArray(linhas) ? linhas : []) {
    if (bruto === null || typeof bruto !== 'object') continue
    const l = bruto as Record<string, unknown>
    const pmo = String(l.pmo ?? '').trim()
    const op = typeof l.op === 'string' ? l.op : ''
    const posto = typeof l.posto === 'string' ? l.posto : ''
    const em = new Date(String(l.em ?? ''))
    if (pmo === '' || op === '' || posto === '' || Number.isNaN(em.getTime())) continue
    const pecas = Number(l.pecas)
    saida.push({
      pmo, op, posto, reprovada: l.reprovada === true,
      numeroSerie: typeof l.numero_serie === 'string' ? l.numero_serie : '',
      pecas: Number.isFinite(pecas) && pecas > 0 ? pecas : 1,
      em,
    })
  }
  return saida
}

/**
 * Monta a tela: as peças agrupadas como a `alerta_travados` agrupa (OP x posto x reprovada) e reunidas por
 * OP com o MESMO `paradosPorOp` do alerta — a linha de cada OP sai igual à da mensagem — mais, por OP, a
 * lista de números de série com a idade de cada um.
 */
export function montarRelatorioParados(
  sns: readonly SnParado[], turnos: readonly Intervalo[], agora: Date,
): RelatorioParados {
  const grupos = new Map<string, GrupoTravado>()
  for (const s of sns) {
    const chave = JSON.stringify([s.pmo, s.op, s.posto, s.reprovada])
    const g = grupos.get(chave)
    if (!g) {
      grupos.set(chave, { pmo: s.pmo, op: s.op, posto: s.posto, reprovada: s.reprovada, pecas: s.pecas, em: s.em, amostras: [] })
    } else {
      g.pecas += s.pecas
      if (s.em < g.em) g.em = s.em
    }
  }
  const porOp = new Map<string, SnParadoComIdade[]>()
  for (const s of sns) {
    const chave = JSON.stringify([s.pmo, s.op])
    const lista = porOp.get(chave) ?? []
    lista.push({ ...s, minutos: minutosDeExpediente(s.em, agora, turnos) })
    porOp.set(chave, lista)
  }
  const ops: OpDoRelatorio[] = paradosPorOp([...grupos.values()], turnos, agora).map((o) => {
    const lista = (porOp.get(JSON.stringify([o.pmo, o.op])) ?? []).sort(
      (a, b) => a.em.getTime() - b.em.getTime() || a.numeroSerie.localeCompare(b.numeroSerie, 'pt-BR', { numeric: true }),
    )
    return { ...o, pecas: o.itens.reduce((t, i) => t + i.pecas, 0), sns: lista }
  })
  return {
    totalPecas: ops.reduce((t, o) => t + o.pecas, 0),
    expediente: turnos.length > 0,
    ops,
  }
}
