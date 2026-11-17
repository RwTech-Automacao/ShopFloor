import { normalizarNs } from './numero-serie'
import { formatarCnpj } from './cnpj'

/**
 * Regras da entrada no SAT: UMA nota com N relógios, e a NF depois da entrada (spec
 * 2026-11-17-sat-entrada-por-nf-design.md, decisões 1, 3 e 8). O banco confere de novo (funções da 0187).
 */
export type SituacaoNf = 'aprovada' | 'reprovada'
export type ItemJunto = 'bobina' | 'chave' | 'fonte' | 'outros'

export const ITENS_JUNTO: { chave: ItemJunto; rotulo: string }[] = [
  { chave: 'bobina', rotulo: 'Bobina' },
  { chave: 'chave', rotulo: 'Chave' },
  { chave: 'fonte', rotulo: 'Fonte' },
  { chave: 'outros', rotulo: 'Outros' },
]

/** Mesmo limite de `sat_registrar_nf` (RELOGIOS_DEMAIS). */
export const MAX_RELOGIOS = 200

const SITUACOES: SituacaoNf[] = ['aprovada', 'reprovada']
const MOTIVO_OBRIGATORIO = 'NF reprovada: escolha ao menos um motivo.'
const CNPJ_INVALIDO = 'Informe o CNPJ da nota (14 dígitos) ou o CPF (11).'
const VALOR_INVALIDO = 'Valor da nota inválido.'

/** Um relógio bipado na nota (valores em texto, como digitados). */
export interface RelogioInput {
  ns: string
  produto: string
  itensJunto: ItemJunto[]
  itensJuntoOutros: string
  locacao: string
}

/** O que a tela manda: a nota (uma vez) e os relógios dela. */
export interface NotaInput {
  cnpj: string
  empresa: string
  /** Código do negociante no Compels, quando a empresa veio de lá. */
  negocianteCodigo: string | null
  numero: string
  valor: string
  situacao: SituacaoNf
  /** ids de `sat_motivos_nf`. */
  motivos: string[]
  relogios: RelogioInput[]
}

export interface RelogioValido extends RelogioInput {
  modelo: string | null
  sequencia: string | null
}

export interface NotaValida extends Omit<NotaInput, 'valor' | 'relogios'> {
  valor: number | null
  relogios: RelogioValido[]
}

/** "1.234,56", "1234.56", "R$ 10" → número; vazio → null; ilegível → NaN. */
export function lerValor(texto: string): number | null {
  let t = (texto ?? '').replace(/R\$/i, '').replace(/\s/g, '')
  if (t === '') return null
  if (t.includes(',')) {
    if ((t.match(/,/g) ?? []).length > 1) return NaN
    t = t.replace(/\./g, '').replace(',', '.')
  }
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN
}

const valorOk = (n: number | null) => n === null || (Number.isFinite(n) && n >= 0 && n < 1e11)

function motivosDaSituacao(situacao: SituacaoNf, motivos: string[]): { ok: true; motivos: string[] } | { ok: false; erro: string } {
  if (!SITUACOES.includes(situacao)) return { ok: false, erro: 'Situação da NF inválida.' }
  if (situacao === 'aprovada') return { ok: true, motivos: [] }
  const unicos = [...new Set((motivos ?? []).filter((m) => typeof m === 'string' && m !== ''))]
  return unicos.length === 0 ? { ok: false, erro: MOTIVO_OBRIGATORIO } : { ok: true, motivos: unicos }
}

/** O mesmo relógio na nota: mesmo modelo + sequência; sem sequência legível, o mesmo texto (como `sat_registrar_nf`). */
const chaveDoRelogio = (ns: string, modelo: string | null, sequencia: string | null) =>
  sequencia ? `${modelo ?? ''}/${sequencia}` : `#${ns.toUpperCase()}`

function validarRelogio(r: RelogioInput): { ok: true; valor: RelogioValido } | { ok: false; erro: string } {
  const ns = (r.ns ?? '').trim()
  if (ns === '') return { ok: false, erro: 'Informe o número de série.' }
  const itens = [...new Set(r.itensJunto ?? [])]
  const outros = itens.includes('outros') ? (r.itensJuntoOutros ?? '').trim() : ''
  if (itens.includes('outros') && outros === '') return { ok: false, erro: `Descreva os outros itens que vieram junto (${ns}).` }
  if (!itens.every((x) => ITENS_JUNTO.some((j) => j.chave === x))) return { ok: false, erro: 'Item que veio junto inválido.' }
  const par = normalizarNs(ns)
  return {
    ok: true,
    valor: {
      ns, modelo: par.modelo, sequencia: par.sequencia, produto: (r.produto ?? '').trim(), itensJunto: itens,
      itensJuntoOutros: outros, locacao: (r.locacao ?? '').trim(),
    },
  }
}

export function validarNota(i: NotaInput): { ok: true; valor: NotaValida } | { ok: false; erro: string } {
  const cnpj = formatarCnpj(i.cnpj)
  if (cnpj === null) return { ok: false, erro: CNPJ_INVALIDO }
  const numero = (i.numero ?? '').trim()
  if (numero === '') return { ok: false, erro: 'Informe o número da NF.' }
  const valor = lerValor(i.valor)
  if (!valorOk(valor)) return { ok: false, erro: VALOR_INVALIDO }
  const m = motivosDaSituacao(i.situacao, i.motivos)
  if (!m.ok) return m
  const relogios = i.relogios ?? []
  if (relogios.length === 0) return { ok: false, erro: 'Bipe ao menos um relógio.' }
  if (relogios.length > MAX_RELOGIOS) return { ok: false, erro: `Uma nota leva no máximo ${MAX_RELOGIOS} relógios.` }

  const validos: RelogioValido[] = []
  const chaves = new Set<string>()
  for (const r of relogios) {
    const v = validarRelogio(r)
    if (!v.ok) return v
    const chave = chaveDoRelogio(v.valor.ns, v.valor.modelo, v.valor.sequencia)
    if (chaves.has(chave)) return { ok: false, erro: `O número de série ${v.valor.ns} está duas vezes nesta nota.` }
    chaves.add(chave)
    validos.push(v.valor)
  }

  return {
    ok: true,
    valor: {
      cnpj, empresa: (i.empresa ?? '').trim(), negocianteCodigo: (i.negocianteCodigo ?? '').trim() || null, numero,
      valor, situacao: i.situacao, motivos: m.motivos, relogios: validos,
    },
  }
}

/** Corrigir (mesma nota, outra situação) ou trocar (nota nova) a NF depois da entrada — vale para todos os relógios dela. */
export type MudancaNf =
  | { tipo: 'corrigir'; situacao: SituacaoNf; motivos: string[] }
  | {
      tipo: 'troca'; numero: string; cnpj: string; empresa: string; negocianteCodigo: string | null; valor: string
      situacao: SituacaoNf; motivos: string[]
    }

export function validarMudancaNf(
  m: MudancaNf,
): { ok: true; motivos: string[]; cnpj?: string; valor?: number | null } | { ok: false; erro: string } {
  if (m.tipo === 'corrigir') return motivosDaSituacao(m.situacao, m.motivos)
  const cnpj = formatarCnpj(m.cnpj)
  if (cnpj === null) return { ok: false, erro: CNPJ_INVALIDO }
  if ((m.numero ?? '').trim() === '') return { ok: false, erro: 'Informe o número da NF nova.' }
  const valor = lerValor(m.valor)
  if (!valorOk(valor)) return { ok: false, erro: VALOR_INVALIDO }
  const r = motivosDaSituacao(m.situacao, m.motivos)
  return r.ok ? { ok: true, motivos: r.motivos, cnpj, valor } : r
}

interface OsOrdenavel {
  numero: string
  data: string | null
  solucao: string
}

/** Mais recente primeiro; sem data no fim; empate pelo número da OS (maior primeiro). */
export function ordenarOs<T extends OsOrdenavel>(os: T[]): T[] {
  return [...os].sort((a, b) => {
    if (a.data !== b.data) {
      if (a.data === null) return 1
      if (b.data === null) return -1
      return a.data < b.data ? 1 : -1
    }
    return b.numero.localeCompare(a.numero, 'pt-BR', { numeric: true })
  })
}

/**
 * Soluções do formulário de abertura de OS em que o equipamento VOLTA para a fábrica (decisão de 17/11): "Envio ao
 * SAT" e "Troca do Relógio". As demais ("Envio de Peça para o Cliente", "Manutenção do display no cliente", os valores
 * antigos da aba 2025, vazio) não passam pela entrada do SAT.
 */
const SOLUCOES_QUE_VOLTAM = ['ENVIO AO SAT', 'TROCA DO RELOGIO']

export function voltaParaFabrica(solucao: string): boolean {
  const s = (solucao ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  return SOLUCOES_QUE_VOLTAM.some((v) => s.includes(v))
}

/**
 * A OS prevista na tela: a mais recente que volta para a fábrica e que ainda não está ligada a outra entrada
 * (`emUso`, ids de OS) — a mesma regra de `sat__os_automatica`, que é quem escolhe de verdade ao gravar.
 */
export function osSugerida<T extends OsOrdenavel & { id: string }>(os: T[], emUso: Set<string>): T | null {
  return ordenarOs(os).find((o) => voltaParaFabrica(o.solucao) && !emUso.has(o.id)) ?? null
}

/** Status v1 (a manutenção entra depois). */
export function rotuloStatus(situacao: SituacaoNf): string {
  return situacao === 'aprovada' ? 'Recebido – NF aprovada' : 'Recebido – NF reprovada'
}
