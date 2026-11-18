/**
 * CADASTRO DE OP INTEGRADO AO COMPELS (spec 2026-11-18). A OP do ShopFloor é a cadeia de OPs do Compels: as PRTs
 * (filhas) e a PMO, cada uma um TRECHO dono de um pedaço dos postos da rota; a PMO é sempre o último. Regras puras
 * (sem banco nem Compels) usadas pela tela Nova OP e conferidas de novo pela action.
 */
import type { OpEspelho } from '@/modules/compels/domain/espelho-ops'
import { faixasSobrepoem, type FaixaSN } from './faixas-sn'
import { faixaCoerente } from './serie'
import { validarOrdem } from './validar-ordem'
import { rotaPadraoOpNova } from './rota-op-nova'

export type { OpEspelho }
export type SnModo = 'mesmo' | 'proprio'
export type TipoTrecho = 'prt' | 'pmo'

export interface TrechoCadastro {
  seq: number
  codigo: string
  tipo: TipoTrecho
  /** Número da OP no Compels; null = cadastro manual. */
  compelsOp: string | null
  descricao: string
  quantidade: number | null
  situacao: string
  /** Só vale nas PRTs; a PMO é sempre 'mesmo'. */
  snModo: SnModo
  postos: string[]
  /** PMO: as faixas da OP. PRT: só com série própria (com 'mesmo' é ignorada). */
  faixas: FaixaSN[]
}

export interface PostoAnterior { posto: string; trechoCodigo: string | null }

export interface UltimaOp {
  op: string
  cliente: string
  descricao: string
  placasPorPainel: number
  embalagemIndividual: boolean
  postos: PostoAnterior[]
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

export interface CadastroOp {
  modo: 'compels' | 'manual'
  pmo: string
  op: string
  cliente: string
  descricao: string
  qtd: number | null
  acp: string
  embalagemIndividual: boolean
  placasPorPainel: number
  trechos: TrechoCadastro[]
  componentes: { posto: string; pmo: string }[]
  burnin: { posto: string; tempo_min: number }[]
}

export interface PmoDoEspelho { pmo: string; descricao: string; abertas: number }

const norm = (s: string) => s.trim().toUpperCase()
const FAIXA_VAZIA: FaixaSN = { sn_ini: '', sn_fim: '' }

/** As PMOs com OP ativa no espelho (só códigos PMO…; as PRTs entram como trechos). */
export function pmosDoEspelho(espelho: OpEspelho[]): PmoDoEspelho[] {
  const m = new Map<string, PmoDoEspelho>()
  for (const o of espelho) {
    if (!o.ativa || !/^PMO/i.test(o.codigo)) continue
    const atual = m.get(o.codigo) ?? { pmo: o.codigo, descricao: o.descricao, abertas: 0 }
    atual.abertas++
    m.set(o.codigo, atual)
  }
  return [...m.values()].sort((a, b) => a.pmo.localeCompare(b.pmo))
}

export function rotuloPmo(p: PmoDoEspelho): string {
  return `${p.pmo} — ${p.descricao} · ${p.abertas} ${p.abertas === 1 ? 'OP aberta' : 'OPs abertas'}`
}

/** As OPs ativas da PMO, da mais nova para a mais velha. */
export function opsDaPmo(espelho: OpEspelho[], pmo: string): OpEspelho[] {
  return espelho.filter((o) => o.ativa && o.codigo === pmo).sort((a, b) => b.numero - a.numero)
}

/** Hora da última leitura do Compels (a mais recente do espelho). */
export function ultimaLeitura(espelho: OpEspelho[]): string | null {
  return espelho.reduce<string | null>((max, o) => (max === null || o.lidoEm > max ? o.lidoEm : max), null)
}

function trechoDe(o: OpEspelho, seq: number, tipo: TipoTrecho): TrechoCadastro {
  return {
    seq, codigo: o.codigo, tipo, compelsOp: String(o.numero), descricao: o.descricao, quantidade: o.quantidade,
    situacao: o.situacao, snModo: 'mesmo', postos: [], faixas: tipo === 'pmo' ? [{ ...FAIXA_VAZIA }] : [],
  }
}

/** Os trechos da OP: as descendentes pela cadeia de mães (a mais funda primeiro) e a PMO por último. */
export function trechosDoEspelho(opPmo: OpEspelho, espelho: OpEspelho[]): TrechoCadastro[] {
  const porNumero = new Map(espelho.map((o) => [o.numero, o]))
  const desce = (o: OpEspelho): boolean => {
    let atual: OpEspelho | undefined = o
    for (let i = 0; i < 20 && atual; i++) {
      if (atual.maeNumero === opPmo.numero) return true
      atual = atual.maeNumero === null ? undefined : porNumero.get(atual.maeNumero)
    }
    return false
  }
  const filhas = espelho
    .filter((o) => o.numero !== opPmo.numero && desce(o))
    .sort((a, b) => b.nivel - a.nivel || a.numero - b.numero)
  return [...filhas.map((o, i) => trechoDe(o, i + 1, 'prt')), trechoDe(opPmo, filhas.length + 1, 'pmo')]
}

/** PMO fora do Compels: um trecho só (a PMO). */
export function trechoManual(pmo: string): TrechoCadastro {
  return {
    seq: 1, codigo: pmo.trim(), tipo: 'pmo', compelsOp: null, descricao: '', quantidade: null, situacao: '',
    snModo: 'mesmo', postos: [], faixas: [{ ...FAIXA_VAZIA }],
  }
}

export function rotuloTrecho(t: { codigo: string; compelsOp: string | null }): string {
  return t.compelsOp ? `${t.codigo} (${t.compelsOp})` : t.codigo
}

/** O Almoxarifado fecha a rota: fica por último no trecho da PMO e nunca numa PRT. */
export function fixarAlmoxarifado(trechos: TrechoCadastro[], almoxarifado: string | null): TrechoCadastro[] {
  if (!almoxarifado) return trechos
  return trechos.map((t) => (t.tipo === 'pmo'
    ? { ...t, postos: rotaPadraoOpNova(t.postos, almoxarifado) }
    : { ...t, postos: t.postos.filter((p) => p !== almoxarifado) }))
}

/** Postos da última OP da PMO: cada um no trecho de mesmo código; o resto (ou OP antiga) no trecho da PMO. */
export function distribuirPostos(trechos: TrechoCadastro[], anteriores: PostoAnterior[], almoxarifado: string | null): TrechoCadastro[] {
  const pmo = trechos.find((t) => t.tipo === 'pmo')
  if (!pmo) return trechos
  const destino = (p: PostoAnterior): number => {
    if (p.trechoCodigo === null) return pmo.seq
    const codigo = norm(p.trechoCodigo)
    return trechos.find((t) => t.tipo === 'prt' && norm(t.codigo) === codigo)?.seq ?? pmo.seq
  }
  const por = new Map(trechos.map((t) => [t.seq, [] as string[]]))
  const vistos = new Set<string>()
  for (const p of anteriores) {
    if (vistos.has(p.posto)) continue
    vistos.add(p.posto)
    por.get(destino(p))!.push(p.posto)
  }
  return fixarAlmoxarifado(trechos.map((t) => ({ ...t, postos: por.get(t.seq)! })), almoxarifado)
}

/**
 * Empurra um posto da ponta de um trecho para o vizinho: para trás (-1) vai para o FIM do anterior; para a
 * frente (+1) vai para o COMEÇO do seguinte. A ordem da rota não muda. Sem vizinho, ou o Almoxarifado: igual.
 */
export function moverPostoEntreTrechos(
  trechos: TrechoCadastro[], seq: number, posto: string, delta: -1 | 1, almoxarifado: string | null,
): TrechoCadastro[] {
  const i = trechos.findIndex((t) => t.seq === seq)
  const j = i + delta
  if (i < 0 || j < 0 || j >= trechos.length || posto === almoxarifado || !trechos[i]!.postos.includes(posto)) return trechos
  return trechos.map((t, k) => {
    if (k === i) return { ...t, postos: t.postos.filter((p) => p !== posto) }
    if (k === j) return { ...t, postos: delta === -1 ? [...t.postos, posto] : [posto, ...t.postos] }
    return t
  })
}

/** Todas as regras da tela (a action confere de novo). Mensagens em PT-BR, a primeira que falhar. */
export function validarCadastro(c: CadastroOp): { ok: true } | { ok: false; erro: string } {
  const ultimo = c.trechos.at(-1)
  if (!ultimo) return { ok: false, erro: 'A OP precisa de pelo menos um trecho.' }
  // Como o sf_cadastrar_op: seq único, uma PMO só, e ela com o maior seq (e por último na lista).
  if (new Set(c.trechos.map((t) => t.seq)).size !== c.trechos.length) {
    return { ok: false, erro: 'Dois trechos estão com o mesmo número de ordem.' }
  }
  const maiorSeq = Math.max(...c.trechos.map((t) => t.seq))
  if (ultimo.tipo !== 'pmo' || ultimo.seq !== maiorSeq || c.trechos.filter((t) => t.tipo === 'pmo').length !== 1) {
    return { ok: false, erro: 'A OP da PMO tem que ser o último trecho.' }
  }
  const v = validarOrdem({
    pmo: c.pmo, op: c.op, cliente: c.cliente, snIni: '', snFim: '', qtd: c.qtd,
    placasPorPainel: c.placasPorPainel, faixas: ultimo.faixas,
  })
  if (!v.ok) return v
  const dono = new Map<string, TrechoCadastro>()
  for (const t of c.trechos) {
    const postos = t.postos.map((p) => p.trim()).filter((p) => p !== '')
    if (postos.length === 0) return { ok: false, erro: `O trecho ${rotuloTrecho(t)} está sem posto.` }
    // O banco compara com btrim: " SPI " e "SPI" são o mesmo posto.
    for (const p of postos) {
      const outro = dono.get(p)
      if (outro === t) return { ok: false, erro: `O posto "${p}" aparece duas vezes no trecho ${rotuloTrecho(t)}.` }
      if (outro) return { ok: false, erro: `O posto "${p}" está em dois trechos: ${rotuloTrecho(outro)} e ${rotuloTrecho(t)}.` }
      dono.set(p, t)
    }
  }
  const todas: { trecho: TrechoCadastro; i: number; f: FaixaSN }[] = ultimo.faixas.map((f, i) => ({ trecho: ultimo, i, f }))
  for (const t of c.trechos) {
    if (t.tipo !== 'prt' || t.snModo !== 'proprio') continue
    if (t.faixas.length === 0) return { ok: false, erro: `${rotuloTrecho(t)}: preencha a faixa da série própria.` }
    for (let i = 0; i < t.faixas.length; i++) {
      const f = t.faixas[i]!
      if (f.sn_ini.trim() === '' || f.sn_fim.trim() === '' || !faixaCoerente(f.sn_ini, f.sn_fim)) {
        return { ok: false, erro: `${rotuloTrecho(t)}: faixa ${i + 1} inválida — início e fim devem ter o mesmo formato, e o início não pode ser maior que o fim.` }
      }
      const choque = todas.find((x) => faixasSobrepoem(x.f, f))
      if (choque) {
        return { ok: false, erro: `A faixa ${i + 1} de ${rotuloTrecho(t)} se sobrepõe à faixa ${choque.i + 1} de ${rotuloTrecho(choque.trecho)}.` }
      }
      todas.push({ trecho: t, i, f })
    }
  }
  return { ok: true }
}
