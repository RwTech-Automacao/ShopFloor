/**
 * ESTRUTURA DA OP (spec 2026-11-13): a receita de uma PMO diz em que posto termina cada PRT (trecho). Regras
 * puras — sem banco nem Compels — para a tela Estruturas, a importação do Compels e a criação da OP.
 */
export type SnModo = 'mesmo' | 'proprio'
export type EstoqueTrecho = 'PA' | 'EINTER'

export interface TrechoReceita {
  /** Ordem do trecho na rota: 1 = o mais fundo (SMD), depois PTH… */
  seq: number
  /** Código da PRT no Compels (ex.: PRT410). */
  codigo: string
  descricao: string
  /** Posto da rota que conclui o trecho; null = ainda não escolhido (rascunho). */
  postoConclui: string | null
  snModo: SnModo
  estoque: EstoqueTrecho
}

/** Uma OP do Compels na árvore abaixo da OP da PMO. */
export interface NoArvore {
  numero: number
  codigo: string
  descricao: string
  nivel: number
  /** Número da OP mãe (null na raiz). */
  mae: number | null
}

const norm = (s: string) => s.trim().toUpperCase()

/** Sugestão de posto pela descrição da PRT: SMD → última inspeção SMD/AOI/SPI antes da PTH; PTH → Inspeção PTH. */
export function sugerirPosto(descricao: string, rota: string[]): string | null {
  const d = norm(descricao)
  if (/\bPTH\b/.test(d)) return rota.find((p) => norm(p) === 'INSPEÇÃO PTH') ?? null
  if (/\bSM[DT]\b/.test(d)) {
    const fimSmd = rota.findIndex((p) => /PTH/i.test(p))
    const antes = fimSmd >= 0 ? rota.slice(0, fimSmd) : rota
    const candidatos = antes.filter((p) => /AOI|SPI|SMD/i.test(p) && /INSPE/i.test(p))
    return candidatos.at(-1) ?? null
  }
  return null
}

/** Descendentes da raiz (pela cadeia de mães), do mais fundo para cima, como trechos de receita em rascunho. */
export function trechosDaArvore(raiz: number, nos: NoArvore[], rota: string[]): TrechoReceita[] {
  const porNumero = new Map(nos.map((n) => [n.numero, n]))
  const desce = (n: NoArvore): boolean => {
    let atual: NoArvore | undefined = n
    for (let i = 0; i < 20 && atual; i++) {
      if (atual.mae === raiz) return true
      atual = atual.mae === null ? undefined : porNumero.get(atual.mae)
    }
    return false
  }
  return nos
    .filter(desce)
    .sort((a, b) => b.nivel - a.nivel || a.numero - b.numero)
    .map((n, i) => ({
      seq: i + 1,
      codigo: n.codigo,
      descricao: n.descricao,
      postoConclui: sugerirPosto(n.descricao, rota),
      snModo: 'mesmo' as const,
      estoque: 'EINTER' as const,
    }))
}

/** Para cada trecho, a OP filha do Compels com o mesmo código (a de menor número se houver mais de uma). */
export function casarTrechos(trechos: { seq: number; codigo: string }[], nos: NoArvore[]): Map<number, number | null> {
  const m = new Map<number, number | null>()
  for (const t of trechos) {
    const achadas = nos.filter((n) => norm(n.codigo) === norm(t.codigo)).map((n) => n.numero).sort((a, b) => a - b)
    m.set(t.seq, achadas[0] ?? null)
  }
  return m
}

/** Pode ativar? Mensagens na ordem dos trechos, uma por problema. */
export function validarParaAtivar(
  trechos: TrechoReceita[],
  rota: string[],
  ehAlmoxarifado: (posto: string) => boolean,
): { ok: true } | { ok: false; erros: string[] } {
  if (trechos.length === 0) return { ok: false, erros: ['A estrutura não tem nenhum trecho.'] }
  const erros: string[] = []
  const usados = new Set<string>()
  let ultimaPos = -1
  for (const t of [...trechos].sort((a, b) => a.seq - b.seq)) {
    if (!t.postoConclui) { erros.push(`${t.codigo}: escolha o posto que conclui este trecho.`); continue }
    if (ehAlmoxarifado(t.postoConclui)) { erros.push(`${t.codigo}: o Almoxarifado é o posto da PMO, não de uma PRT.`); continue }
    const pos = rota.indexOf(t.postoConclui)
    if (pos < 0) { erros.push(`${t.codigo}: o posto "${t.postoConclui}" não está na rota da PMO.`); continue }
    if (usados.has(t.postoConclui)) { erros.push(`${t.codigo}: o posto "${t.postoConclui}" já conclui outro trecho.`); continue }
    if (pos < ultimaPos) { erros.push(`${t.codigo}: os trechos precisam seguir a ordem da rota (este posto vem antes do trecho anterior).`); continue }
    if (t.snModo === 'proprio') { erros.push(`${t.codigo}: SN próprio ainda não suportado.`); continue }
    usados.add(t.postoConclui)
    ultimaPos = pos
  }
  return erros.length ? { ok: false, erros } : { ok: true }
}
