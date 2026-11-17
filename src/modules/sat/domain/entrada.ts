import { normalizarNs } from './numero-serie'

/**
 * Regras da entrada do equipamento no SAT (metade de cima da FO-161) e da NF depois da entrada
 * (spec 2026-11-17-sat-entrada-design.md, decisões 5 a 9). O banco confere de novo (funções da 0186).
 */
export type SituacaoNf = 'aprovada' | 'reprovada'
export type Frete = 'a_cobrar' | 'pago'
export type ItemJunto = 'bobina' | 'chave' | 'fonte' | 'outros'

export const ITENS_JUNTO: { chave: ItemJunto; rotulo: string }[] = [
  { chave: 'bobina', rotulo: 'Bobina' },
  { chave: 'chave', rotulo: 'Chave' },
  { chave: 'fonte', rotulo: 'Fonte' },
  { chave: 'outros', rotulo: 'Outros' },
]

export const FRETES: { chave: Frete; rotulo: string }[] = [
  { chave: 'a_cobrar', rotulo: 'A cobrar' },
  { chave: 'pago', rotulo: 'Pago' },
]

const SITUACOES: SituacaoNf[] = ['aprovada', 'reprovada']
const MOTIVO_OBRIGATORIO = 'NF reprovada: escolha ao menos um motivo.'

/** O que a tela manda (valores em texto, como digitados). */
export interface EntradaInput {
  ns: string
  osId: string | null
  empresa: string
  cnpj: string
  produto: string
  nf: string
  valor: string
  frete: Frete | null
  itensJunto: ItemJunto[]
  itensJuntoOutros: string
  defeito: string
  locacao: string
  custo: string
  situacao: SituacaoNf
  /** ids de `sat_motivos_nf`. */
  motivos: string[]
}

export interface EntradaValida extends Omit<EntradaInput, 'valor' | 'custo'> {
  modelo: string | null
  sequencia: string | null
  valor: number | null
  custo: number | null
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

export function validarEntrada(i: EntradaInput): { ok: true; valor: EntradaValida } | { ok: false; erro: string } {
  const ns = (i.ns ?? '').trim()
  if (ns === '') return { ok: false, erro: 'Informe o número de série.' }
  const nf = (i.nf ?? '').trim()
  if (nf === '') return { ok: false, erro: 'Informe a NF de entrada.' }
  const m = motivosDaSituacao(i.situacao, i.motivos)
  if (!m.ok) return m
  if (i.frete !== null && !FRETES.some((f) => f.chave === i.frete)) return { ok: false, erro: 'Frete inválido.' }
  const itens = [...new Set(i.itensJunto ?? [])]
  if (!itens.every((x) => ITENS_JUNTO.some((j) => j.chave === x))) return { ok: false, erro: 'Item que veio junto inválido.' }
  const outros = itens.includes('outros') ? (i.itensJuntoOutros ?? '').trim() : ''
  if (itens.includes('outros') && outros === '') return { ok: false, erro: 'Descreva os outros itens que vieram junto.' }
  const valor = lerValor(i.valor)
  if (!valorOk(valor)) return { ok: false, erro: 'Valor unitário inválido.' }
  const custo = lerValor(i.custo)
  if (!valorOk(custo)) return { ok: false, erro: 'Custo inválido.' }

  const par = normalizarNs(ns)
  return {
    ok: true,
    valor: {
      ns, modelo: par.modelo, sequencia: par.sequencia, osId: i.osId || null,
      empresa: (i.empresa ?? '').trim(), cnpj: (i.cnpj ?? '').trim(), produto: (i.produto ?? '').trim(), nf,
      valor, frete: i.frete, itensJunto: itens, itensJuntoOutros: outros, defeito: (i.defeito ?? '').trim(),
      locacao: (i.locacao ?? '').trim(), custo, situacao: i.situacao, motivos: m.motivos,
    },
  }
}

/** Corrigir (mesma nota, outra situação) ou trocar (nota nova) a NF depois da entrada. */
export type MudancaNf =
  | { tipo: 'corrigir'; situacao: SituacaoNf; motivos: string[] }
  | { tipo: 'troca'; nf: string; situacao: SituacaoNf; motivos: string[] }

export function validarMudancaNf(m: MudancaNf): { ok: true; motivos: string[] } | { ok: false; erro: string } {
  if (m.tipo === 'troca' && (m.nf ?? '').trim() === '') return { ok: false, erro: 'Informe a NF nova.' }
  return motivosDaSituacao(m.situacao, m.motivos)
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

/** A OS já escolhida na tela: a mais recente que volta para a fábrica; nenhuma volta = nenhuma (entrada "Sem OS"). */
export function osSugerida<T extends OsOrdenavel>(os: T[]): T | null {
  return ordenarOs(os).find((o) => voltaParaFabrica(o.solucao)) ?? null
}

/** A coluna CLIENTE da planilha às vezes traz o CNPJ junto do nome. */
export function cnpjDoCliente(texto: string): { nome: string; cnpj: string } {
  const t = (texto ?? '').trim()
  const m = /(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})/.exec(t)
  if (!m) return { nome: t, cnpj: '' }
  const cnpj = `${m[1]}.${m[2]}.${m[3]}/${m[4]}-${m[5]}`
  const nome = (t.slice(0, m.index) + t.slice(m.index + m[0].length))
    .replace(/CNPJ\s*:?/i, '').replace(/[\s\-–—/:|,]+$/, '').replace(/^[\s\-–—/:|,]+/, '').trim()
  return { nome, cnpj }
}

/** Status v1 (a manutenção entra depois). */
export function rotuloStatus(situacao: SituacaoNf): string {
  return situacao === 'aprovada' ? 'Recebido – NF aprovada' : 'Recebido – NF reprovada'
}
