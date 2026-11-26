import { codigoDoProduto } from '../domain/ordem'
import { codigosDaArvore, kitServe, pecasTrocaveis, type NoEstrutura, type PecaSugerida } from '../domain/estrutura'

/**
 * A lista de peças da manutenção, camadas 1 a 3 (spec 2026-11-26, decisão 6; a 4 é a busca):
 *   1. as mais trocadas neste produto (histórico do ShopFloor; o do Compels chega na entrega 6);
 *   2. os kits de reposição (PMOE*) que servem ao produto: candidatos = kits já usados + pais PMOE* das peças
 *      trocáveis; serve quando todos os componentes do kit estão na árvore do produto (calculado, ninguém cadastra);
 *   3. as peças trocáveis da estrutura (regra em `pecasTrocaveis`).
 * Um código aparece só na primeira camada em que entra. Falha do Compels vira aviso, nunca erro da tela.
 */
export interface DepsPecas {
  maisUsadas(produto: string): Promise<PecaSugerida[]>
  kitsConhecidos(): Promise<PecaSugerida[]>
  estrutura(codigo: string): Promise<NoEstrutura[] | null>
  paisDoItem(itemId: number): Promise<PecaSugerida[]>
}

export interface CamadasPecas {
  maisUsadas: PecaSugerida[]
  kits: PecaSugerida[]
  estrutura: PecaSugerida[]
  avisos: string[]
}

export const MAX_NOS_PARA_PAIS = 30
export const MAX_KITS_AVALIADOS = 20
const EM_PARALELO = 5

async function emLotes<T, R>(itens: T[], fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = []
  for (let i = 0; i < itens.length; i += EM_PARALELO) saida.push(...(await Promise.all(itens.slice(i, i + EM_PARALELO).map(fn))))
  return saida
}

function semRepetir(camadas: PecaSugerida[][]): PecaSugerida[][] {
  const vistos = new Set<string>()
  return camadas.map((c) => c.filter((p) => {
    if (vistos.has(p.codigo)) return false
    vistos.add(p.codigo)
    return true
  }))
}

export async function pecasSugeridas(produto: string, deps: DepsPecas): Promise<CamadasPecas> {
  const avisos: string[] = []
  const maisUsadas = await deps.maisUsadas(produto.trim()).catch(() => {
    avisos.push('Não foi possível ler as peças mais usadas neste modelo agora.')
    return [] as PecaSugerida[]
  })
  const fim = (kits: PecaSugerida[], estrutura: PecaSugerida[]): CamadasPecas => {
    const [a, b, c] = semRepetir([maisUsadas, kits, estrutura])
    return { maisUsadas: a!, kits: b!, estrutura: c!, avisos }
  }

  const codigo = codigoDoProduto(produto)
  if (!codigo) {
    avisos.push('O produto desta OS não é um código do Compels: as camadas de kits e de estrutura ficam vazias. Use a busca.')
    return fim([], [])
  }

  let arvore: NoEstrutura[] | null
  try {
    arvore = await deps.estrutura(codigo)
  } catch {
    avisos.push('Não foi possível ler a estrutura do produto no Compels agora. Use a busca.')
    return fim([], [])
  }
  if (arvore === null) {
    avisos.push(`O produto ${codigo} não tem estrutura no Compels.`)
    return fim([], [])
  }

  const trocaveis = pecasTrocaveis(arvore)
  const codigosProduto = codigosDaArvore(arvore)

  const falhas = { pais: false, kits: false, estrutura: false }
  // candidatos a kit: os já usados + os pais PMOE* das peças trocáveis
  const candidatos = new Map<string, string>()
  const conhecidos = await deps.kitsConhecidos().catch(() => {
    falhas.kits = true
    return [] as PecaSugerida[]
  })
  for (const k of conhecidos) {
    if (k.codigo.startsWith('PMOE')) candidatos.set(k.codigo, k.descricao)
  }
  const comId = trocaveis.filter((t) => t.itemId !== null).slice(0, MAX_NOS_PARA_PAIS)
  const pais = await emLotes(comId, (t) => deps.paisDoItem(t.itemId!).catch(() => {
    falhas.pais = true
    return [] as PecaSugerida[]
  }))
  for (const p of pais.flat()) if (p.codigo.startsWith('PMOE') && !candidatos.has(p.codigo)) candidatos.set(p.codigo, p.descricao)
  if (falhas.pais || falhas.kits) avisos.push('Não foi possível procurar todos os kits no Compels agora.')
  candidatos.delete(codigo)

  const avaliar = [...candidatos.keys()].sort().slice(0, MAX_KITS_AVALIADOS)
  const servem = await emLotes(avaliar, async (k) => {
    try {
      const a = await deps.estrutura(k)
      return a !== null && kitServe(a, codigosProduto)
    } catch {
      falhas.estrutura = true
      return false
    }
  })
  if (falhas.estrutura && !falhas.pais && !falhas.kits) avisos.push('Não foi possível procurar todos os kits no Compels agora.')
  const kits = avaliar.filter((_, i) => servem[i]).map((k) => ({ codigo: k, descricao: candidatos.get(k) ?? '' }))
  const estrutura = trocaveis.map((t) => ({ codigo: t.codigo, descricao: t.descricao }))
  return fim(kits, estrutura)
}
