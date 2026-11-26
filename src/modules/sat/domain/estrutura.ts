import { listaDe, RespostaInesperada } from '../../compels/domain/leituras-erp'

/**
 * A estrutura do produto no Compels (composicaoProduto) e as camadas 2 e 3 da lista de peças da manutenção do SAT
 * (spec 2026-11-26-sat-ordem-servico-design.md, decisão 6). Tudo puro: entram as respostas cruas, saem listas.
 */
export interface NoEstrutura {
  codigo: string
  descricao: string
  /** Id interno do item no Compels (vai no findParentsByItemId); null se a resposta não trouxe. */
  itemId: number | null
  filhos: NoEstrutura[]
}

export interface PecaSugerida {
  codigo: string
  descricao: string
}

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null)
const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const PROFUNDIDADE_MAXIMA = 15

/** `findByCodigoItem`: o id da composição do item; null = o item não tem estrutura. */
export function idDaComposicao(resposta: unknown): number | null {
  const r = obj(resposta)
  const d = r && 'data' in r ? r.data : resposta
  const alvo = Array.isArray(d) ? d[0] : d
  const id = obj(alvo)?.id
  return typeof id === 'number' && Number.isFinite(id) ? id : null
}

function lerNo(v: unknown, profundidade: number): NoEstrutura | null {
  const o = obj(v)
  if (!o || profundidade > PROFUNDIDADE_MAXIMA) return null
  const item = obj(o.item)
  const codigo = txt(item?.codigo).toUpperCase()
  if (codigo === '') return null
  const filhos = Array.isArray(o.children) ? o.children : []
  return {
    codigo,
    descricao: txt(item?.descricao),
    itemId: typeof item?.id === 'number' ? item.id : null,
    filhos: filhos.map((f) => lerNo(f, profundidade + 1)).filter((x): x is NoEstrutura => x !== null),
  }
}

/**
 * `findComposicaoByIdEntireTree` devolve `{children, success}`. Devolve os nós de 1º nível (cada um com os filhos).
 * Se a raiz vier como um nó só, que é o próprio produto, desce nele.
 */
export function arvoreDaResposta(resposta: unknown, codigoProduto: string): NoEstrutura[] {
  const r = obj(resposta)
  if (!r || !Array.isArray(r.children)) throw new RespostaInesperada('estrutura do produto')
  const nos = r.children.map((f) => lerNo(f, 1)).filter((x): x is NoEstrutura => x !== null)
  if (nos.length === 1 && nos[0]!.codigo === codigoProduto.trim().toUpperCase()) return nos[0]!.filhos
  return nos
}

/** Prefixos que nunca entram na camada 3: PRT = etapa SMD/PTH da placa; RWSV = serviço (injeção, pintura). */
export const PREFIXOS_FORA_DA_LISTA = ['PRT', 'RWSV']
const EMBALAGEM = /\b(EMBALAGEM|CAIXA DE PAPELAO|CAIXA PAPELAO|SACO|ETIQUETA|MANUAL|CALCO|PLASTICO BOLHA|FITA)\b/
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()

export function foraDaLista(n: NoEstrutura): boolean {
  return PREFIXOS_FORA_DA_LISTA.some((p) => n.codigo.startsWith(p)) || EMBALAGEM.test(semAcento(n.descricao))
}

/**
 * Camada 3: as peças trocáveis do produto = nós de 1º e 2º nível que são subconjunto montado (têm filhos) ou têm
 * código PMO*, fora os PRT, os RWSV e a embalagem. O nó PRT não entra, mas os filhos dele são olhados (até o 2º nível);
 * serviço e embalagem não são abertos. Folha sem PMO* (parafuso, componente) fica fora. Sem repetir código.
 */
export function pecasTrocaveis(arvore: NoEstrutura[]): NoEstrutura[] {
  const saida = new Map<string, NoEstrutura>()
  const fila: { n: NoEstrutura; nivel: number }[] = arvore.map((n) => ({ n, nivel: 1 }))
  while (fila.length > 0) {
    const { n, nivel } = fila.shift()!
    const ehPrt = n.codigo.startsWith('PRT')
    if (foraDaLista(n) && !ehPrt) continue
    if (!foraDaLista(n) && (n.filhos.length > 0 || n.codigo.startsWith('PMO')) && !saida.has(n.codigo)) saida.set(n.codigo, n)
    if (nivel < 2) fila.push(...n.filhos.map((f) => ({ n: f, nivel: nivel + 1 })))
  }
  return [...saida.values()]
}

/** Todos os códigos da árvore, em qualquer nível. */
export function codigosDaArvore(arvore: NoEstrutura[]): Set<string> {
  const s = new Set<string>()
  const andar = (ns: NoEstrutura[]) => ns.forEach((n) => { s.add(n.codigo); andar(n.filhos) })
  andar(arvore)
  return s
}

/** Camada 2: o kit serve quando TODOS os componentes de 1º nível dele (sem serviço/embalagem) estão no produto. */
export function kitServe(kit: NoEstrutura[], codigosProduto: Set<string>): boolean {
  const componentes = kit.filter((n) => !n.codigo.startsWith('RWSV') && !EMBALAGEM.test(semAcento(n.descricao)))
  return componentes.length > 0 && componentes.every((n) => codigosProduto.has(n.codigo))
}

function pecaDaLinha(l: Obj): PecaSugerida | null {
  const item = obj(l.item) ?? l
  const codigo = txt(item.codigo).toUpperCase()
  return codigo === '' ? null : { codigo, descricao: txt(item.descricao) }
}

const semRepetir = (xs: (PecaSugerida | null)[]) => {
  const m = new Map<string, PecaSugerida>()
  for (const x of xs) if (x && !m.has(x.codigo)) m.set(x.codigo, x)
  return [...m.values()]
}

/** `findParentsByItemId`: os itens que usam este item na estrutura. */
export function paisDaResposta(resposta: unknown): PecaSugerida[] {
  return semRepetir(listaDe(resposta, 'pais do item').map(pecaDaLinha))
}

/** `itemMovimento/findFilter`: as linhas viram código + descrição (até `limite`). */
export function itensDaBusca(resposta: unknown, limite = 30): PecaSugerida[] {
  return semRepetir(listaDe(resposta, 'busca de itens').map(pecaDaLinha)).slice(0, limite)
}

/** Termo com cara de código (letras + dígito, sem espaço) vai em `codigo`; o resto em `descricao`. */
export function filtroBuscaItem(termo: string, dataIso: string): Record<string, unknown> {
  const t = termo.trim()
  const pareceCodigo = /^[A-Za-z]{2,}[A-Za-z0-9_.-]*\d[A-Za-z0-9_.-]*$/.test(t)
  return { codigo: pareceCodigo ? t.toUpperCase() : '', descricao: pareceCodigo ? '' : t, data: dataIso, exibeItensComSaldoZerado: true }
}
