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
  /** Edição: PRT da cadeia incluída de novo nesta edição, ainda não gravada (seq < 0 só enquanto está na tela). */
  incluida?: boolean
  /** Só na tela: postos que uma PRT ignorada ("manter") trouxe para este trecho; não vai para o servidor. */
  herdados?: string[]
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
  /** PRTs da cadeia do Compels que ficaram fora da OP (não são trecho) e a escolha de cada uma. */
  ignoradas?: PrtIgnoradaEnvio[]
}

/** Ignorar uma PRT: 'tirar' = os postos dela saem da rota; 'manter' = vão para o começo do trecho seguinte. */
export type ModoIgnorar = 'tirar' | 'manter'

/** A escolha como aparece nos botões, na lista de ignoradas e no log. */
export const ESCOLHA_IGNORAR: Record<ModoIgnorar, string> = {
  tirar: 'Tirar os postos da rota',
  manter: 'Manter os postos na rota da OP',
}

/** Uma PRT ignorada na tela: o trecho como estava (para o Desfazer) e a escolha. */
export interface PrtIgnorada { trecho: TrechoCadastro; modo: ModoIgnorar }

/** O que vai para o servidor (e para o log) de cada PRT ignorada. */
export interface PrtIgnoradaEnvio { codigo: string; compelsOp: string | null; modo: ModoIgnorar }

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

/** A identidade de um trecho na cadeia do Compels: o código (aparado, maiúsculo) e a OP do Compels. */
export function chaveTrecho(t: { codigo: string; compelsOp: string | null }): string {
  return `${norm(t.codigo)}|${t.compelsOp ?? ''}`
}

/**
 * Ignora a PRT de `seq`: ela deixa de ser trecho. 'tirar' some com os postos dela; 'manter' os põe no COMEÇO do trecho
 * seguinte (a ordem da rota não muda; a última PRT antes da PMO passa os postos para a PMO). A PMO nunca: null.
 */
export function ignorarPrt(
  trechos: TrechoCadastro[], seq: number, modo: ModoIgnorar,
): { trechos: TrechoCadastro[]; ignorada: PrtIgnorada } | null {
  const i = trechos.findIndex((t) => t.seq === seq)
  const t = trechos[i]
  if (!t || t.tipo !== 'prt' || i === trechos.length - 1) return null
  const resto = trechos.filter((_, k) => k !== i)
  // Os postos próprios da PRT; os herdados de uma ignorada anterior "manter" seguem na rota (vão para o trecho seguinte).
  const { herdados, ...base } = t
  const herd = new Set(herdados ?? [])
  const proprios = t.postos.filter((p) => !herd.has(p))
  const levam = modo === 'manter' ? t.postos : t.postos.filter((p) => herd.has(p))
  const novos = levam.length
    ? resto.map((x, k) => (k === i ? { ...x, postos: [...levam, ...x.postos], herdados: [...levam, ...(x.herdados ?? [])] } : x))
    : resto
  // O snapshot guarda só os postos PRÓPRIOS da PRT (sem os que uma ignorada anterior "manter" trouxe para ela).
  const proprio: TrechoCadastro = { ...base, postos: proprios }
  return { trechos: novos, ignorada: { trecho: proprio, modo } }
}

/**
 * Desfaz o "ignorar": a PRT volta a ser trecho, no lugar dela na cadeia (pelo seq da tela), com os postos que tinha —
 * tirados de onde estiverem agora. Já presente: igual.
 */
export function desfazerIgnorar(trechos: TrechoCadastro[], ignorada: PrtIgnorada): TrechoCadastro[] {
  const volta = ignorada.trecho
  if (trechos.some((t) => t.seq === volta.seq)) return trechos
  const dela = new Set(volta.postos)
  const sem = trechos.map((t) => {
    if (!t.postos.some((p) => dela.has(p)) && !t.herdados?.some((p) => dela.has(p))) return t
    const { herdados, ...r } = t
    const h = (herdados ?? []).filter((p) => !dela.has(p))
    return { ...r, postos: t.postos.filter((p) => !dela.has(p)), ...(h.length ? { herdados: h } : {}) }
  })
  const k = sem.findIndex((t) => t.seq > volta.seq)
  const at = k < 0 ? sem.length : k
  return [...sem.slice(0, at), volta, ...sem.slice(at)]
}

/** Os trechos como vão para o servidor: seq renumerado 1..n na ordem da rota, sem buraco das PRTs ignoradas. */
export function trechosParaEnviar(trechos: TrechoCadastro[]): TrechoCadastro[] {
  return trechos.map((t, i) => {
    const { herdados: _h, ...r } = t
    return t.seq === i + 1 && !t.herdados ? t : { ...r, seq: i + 1 }
  })
}

export function ignoradasParaEnviar(ignoradas: PrtIgnorada[]): PrtIgnoradaEnvio[] {
  return ignoradas.map((i) => ({ codigo: i.trecho.codigo, compelsOp: i.trecho.compelsOp, modo: i.modo }))
}

/**
 * O cadastro no modo Compels confere a cadeia: os trechos são os do espelho (`esperado`, de trechosDoEspelho) menos as
 * PRTs ignoradas, na mesma ordem, com seq 1..n. Ignorada só PRT da cadeia, uma vez, com escolha válida. null = bate.
 */
export function erroCadeiaCompels(
  esperado: TrechoCadastro[], trechos: TrechoCadastro[], ignoradas: PrtIgnoradaEnvio[],
): string | null {
  const NAO_BATE = 'Os trechos não batem com o Compels. Recarregue a página e escolha a OP de novo.'
  const pmo = esperado.find((t) => t.tipo === 'pmo')
  if (pmo && ignoradas.some((i) => chaveTrecho(i) === chaveTrecho(pmo))) return 'A OP da PMO não pode ser ignorada.'
  const fora = new Set(ignoradas.map(chaveTrecho))
  if (fora.size !== ignoradas.length) return NAO_BATE
  for (const i of ignoradas) {
    if (i.modo !== 'tirar' && i.modo !== 'manter') return NAO_BATE
    if (!esperado.some((e) => e.tipo === 'prt' && chaveTrecho(e) === chaveTrecho(i))) return NAO_BATE
  }
  const restantes = esperado.filter((e) => !fora.has(chaveTrecho(e)))
  const bate = restantes.length === trechos.length && restantes.every((e, i) => {
    const t = trechos[i]!
    return e.codigo === t.codigo && e.compelsOp === t.compelsOp && e.tipo === t.tipo && t.seq === i + 1
  })
  return bate ? null : NAO_BATE
}

/** A linha do log do cadastro com as PRTs ignoradas e a escolha de cada uma; null sem ignorada. */
export function resumoIgnoradas(ignoradas: PrtIgnoradaEnvio[]): string | null {
  if (ignoradas.length === 0) return null
  const itens = ignoradas.map((i) => `${rotuloTrecho(i)} — ${ESCOLHA_IGNORAR[i.modo]}`)
  return `${ignoradas.length === 1 ? 'PRT ignorada' : 'PRTs ignoradas'}: ${itens.join('; ')}`
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

/**
 * No modo Compels o número da OP é o da OP do Compels (`base`) ou ele com sufixo `_` + 1–10 letras/dígitos.
 * Devolve a mensagem em PT-BR quando não vale, ou null. Usada pela tela e pela action.
 */
export function erroSufixoOp(base: string, op: string): string | null {
  const b = base.trim()
  const n = op.trim()
  const ok = b !== '' && (n === b || (n.startsWith(`${b}_`) && /^[A-Za-z0-9]{1,10}$/.test(n.slice(b.length + 1))))
  return ok ? null : `O número da OP tem que ser o da OP do Compels (${b}) ou ele com sufixo (ex.: ${b}_F).`
}
