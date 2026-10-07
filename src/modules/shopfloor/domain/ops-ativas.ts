/**
 * Regras da lista de OPs em andamento que o Dashboard Enterplak consome
 * (`GET /api/dashboard/ops-ativas`). Tudo aqui é PURO: a rota só busca as linhas e aplica isto.
 */

/** Linha de `sf_ordens` como a rota a seleciona. */
export interface LinhaOrdem {
  pmo: string
  op: string
  cliente: string
  descricao: string
  status: string | null
}

/** Linha de `sf_registros` (um bipe) como a rota a seleciona. */
export interface LinhaBipe {
  pmo: string
  op: string
  data_hora: string | null
}

/** Uma OP em andamento, do jeito que sai na resposta. `ultimoBipe` é nulo quando não teve nenhum. */
export interface OpAtiva {
  pmo: string
  op: string
  cliente: string
  descricao: string
  ultimoBipe: string | null
}

/** O status terminal de `sf_ordens` (ver 0101_sf_dashboard.sql: `upper(o.status) = 'FINALIZADA'`). */
const STATUS_FINALIZADA = 'FINALIZADA'

const DIAS_MIN = 1
const DIAS_MAX = 365

/** Só dígitos: recusa `+30`, `1e2`, `1.5`, `-5`, `0x1e` e `Infinity` sem depender do Number(). */
const RE_INTEIRO = /^\d+$/

/**
 * Valida o `dias` da query string.
 *
 * - ausente / vazio / só espaços → `null`: a lista NÃO é recortada por data.
 * - inteiro de 1 a 365 → o número.
 * - qualquer outra coisa → `'invalido'` (a rota responde 400).
 *
 * A faixa é fechada nas duas pontas: `1` e `365` passam, `0` e `366` não.
 */
export function validarDias(valor: unknown): number | null | 'invalido' {
  if (valor === undefined || valor === null) return null
  if (typeof valor !== 'string') return 'invalido'
  const texto = valor.trim()
  if (texto === '') return null
  if (!RE_INTEIRO.test(texto)) return 'invalido'
  const n = Number(texto)
  if (n < DIAS_MIN || n > DIAS_MAX) return 'invalido'
  return n
}

/**
 * A OP está encerrada?
 *
 * Case-insensitive de propósito: o status é texto livre em `sf_ordens` e já veio gravado em mais de
 * uma grafia ao longo da história da planilha. Comparar sensível à caixa deixaria OP finalizada
 * aparecendo como "em andamento" no dashboard.
 */
export function ehOpFinalizada(status: string | null | undefined): boolean {
  return (status ?? '').trim().toUpperCase() === STATUS_FINALIZADA
}

/**
 * Data do banco normalizada para ISO em UTC (`2026-10-06T11:42:10.000Z`).
 *
 * O PostgREST devolve `timestamptz` com deslocamento (`+00:00`), e o dashboard compara/exibe texto:
 * uma forma só evita que a mesma hora apareça de dois jeitos. Data impossível vira `null` em vez de
 * `Invalid Date` virando string.
 */
export function paraIsoUtc(valor: string | null | undefined): string | null {
  if (!valor) return null
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** O corte do recorte: `agora − dias`, em ISO UTC (o que vai no `gte` do `data_hora`). */
export function corteParaDias(agora: Date, dias: number): string {
  return new Date(agora.getTime() - dias * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Chave da OP. `\0` como separador porque é o único byte que não aparece em texto do Postgres —
 * com um separador qualquer, `('A','BC')` e `('AB','C')` cairiam na mesma chave.
 */
export function chaveOp(pmo: string, op: string): string {
  return `${pmo}\u0000${op}`
}

/** Último bipe (o mais recente) de cada OP, em ISO UTC, a partir das linhas em qualquer ordem. */
export function ultimoBipePorOp(linhas: LinhaBipe[]): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const l of linhas) {
    const quando = paraIsoUtc(l.data_hora)
    if (!quando) continue
    const chave = chaveOp(l.pmo, l.op)
    const atual = mapa.get(chave)
    if (!atual || quando > atual) mapa.set(chave, quando)
  }
  return mapa
}

/**
 * Monta a lista final: tira as finalizadas, pendura o último bipe, aplica o recorte e ordena.
 *
 * `exigeBipe` liga a regra do `dias`: com recorte, OP sem nenhum bipe no período sai da lista;
 * sem recorte, ela fica (no fim, onde ficam as sem bipe).
 */
export function montarOpsAtivas(ordens: LinhaOrdem[], bipes: LinhaBipe[], exigeBipe: boolean): OpAtiva[] {
  const ultimo = ultimoBipePorOp(bipes)
  const ops: OpAtiva[] = []
  for (const o of ordens) {
    if (ehOpFinalizada(o.status)) continue
    const ultimoBipe = ultimo.get(chaveOp(o.pmo, o.op)) ?? null
    if (exigeBipe && !ultimoBipe) continue
    ops.push({ pmo: o.pmo, op: o.op, cliente: o.cliente, descricao: o.descricao, ultimoBipe })
  }
  return ordenarPorUltimoBipe(ops)
}

/**
 * Mais recente primeiro; as OPs SEM bipe por ÚLTIMO (nunca no começo: elas não são "as mais
 * recentes"). Empate desempatado por pmo e op, para a lista não embaralhar entre duas chamadas.
 */
export function ordenarPorUltimoBipe(ops: OpAtiva[]): OpAtiva[] {
  return [...ops].sort((a, b) => {
    if (a.ultimoBipe !== b.ultimoBipe) {
      if (!a.ultimoBipe) return 1
      if (!b.ultimoBipe) return -1
      return a.ultimoBipe < b.ultimoBipe ? 1 : -1
    }
    if (a.pmo !== b.pmo) return a.pmo < b.pmo ? -1 : 1
    if (a.op !== b.op) return a.op < b.op ? -1 : 1
    return 0
  })
}
