import 'server-only'
import type { ClienteCompels } from '@/modules/compels/infra/cliente'
import { clienteCompelsDoFaturamento } from '@/modules/faturamento/infra/compels'
import {
  arvoreDaResposta, filtroBuscaItem, idDaComposicao, itensDaBusca, paisDaResposta,
  type NoEstrutura, type PecaSugerida,
} from '../domain/estrutura'
import { armazemDoBanco, lerComCache, type ArmazemCache } from './cache-compels'

/** O login do Compels não está neste ambiente (Dev sem `COMPELS_*`): a tela mostra o aviso e segue com a busca. */
export class CompelsIndisponivel extends Error {
  constructor() {
    super('Compels indisponível neste ambiente.')
    this.name = 'CompelsIndisponivel'
  }
}

const texto = (v: unknown) => typeof v === 'string'
const ehNo = (v: unknown, nivel = 0): boolean => {
  if (nivel > 15 || !v || typeof v !== 'object') return false
  const n = v as Record<string, unknown>
  return texto(n.codigo) && texto(n.descricao) && (n.itemId === null || typeof n.itemId === 'number')
    && Array.isArray(n.filhos) && n.filhos.every((f) => ehNo(f, nivel + 1))
}
/** O cache é gravável por quem tem sat.manutencao: só vale o que tem o formato esperado. */
const ehEstrutura = (v: unknown): v is { arvore: NoEstrutura[] | null } => {
  if (!v || typeof v !== 'object' || !('arvore' in v)) return false
  const a = (v as { arvore: unknown }).arvore
  return a === null || (Array.isArray(a) && a.every((n) => ehNo(n)))
}
const ehListaDePecas = (v: unknown): v is PecaSugerida[] =>
  Array.isArray(v) && v.every((p) => p && typeof p === 'object' && texto((p as PecaSugerida).codigo) && texto((p as PecaSugerida).descricao))

type LeitorCompels = Pick<ClienteCompels, 'composicaoDoItem' | 'arvoreDaComposicao' | 'paisDoItem' | 'buscarItens'>

/** As leituras do Compels da manutenção (SÓ LEITURA), com cache de 7 dias para estrutura e pais. */
export function leiturasDoCompels(
  cliente: LeitorCompels | null = clienteCompelsDoFaturamento(),
  armazem: ArmazemCache = armazemDoBanco(),
) {
  const exigir = (): LeitorCompels => {
    if (!cliente) throw new CompelsIndisponivel()
    return cliente
  }
  return {
    /** A árvore do produto; `null` = o item não tem estrutura no Compels. */
    async estrutura(codigoBruto: string): Promise<NoEstrutura[] | null> {
      const codigo = codigoBruto.trim().toUpperCase() // a chave do cache só aceita maiúsculas
      const r = await lerComCache(`estrutura:${codigo}`, async () => {
        const c = exigir()
        const id = idDaComposicao(await c.composicaoDoItem(codigo))
        return { arvore: id === null ? null : arvoreDaResposta(await c.arvoreDaComposicao(id), codigo) }
      }, armazem, Date.now(), ehEstrutura)
      return r.arvore
    },
    async paisDoItem(itemId: number): Promise<PecaSugerida[]> {
      return lerComCache(`pais:${itemId}`, async () => paisDaResposta(await exigir().paisDoItem(itemId)), armazem, Date.now(), ehListaDePecas)
    },
    /** Camada 4: sem cache (cada busca é um termo novo). */
    async buscarItens(termo: string): Promise<PecaSugerida[]> {
      const hoje = new Date().toISOString().slice(0, 10) + 'T00:00:00'
      return itensDaBusca(await exigir().buscarItens(filtroBuscaItem(termo, hoje)))
    },
  }
}
