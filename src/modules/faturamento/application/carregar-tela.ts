import { codigoDaLinha, lerNota, ordenarPorEmissao, type NotaPendente } from '@/modules/compels/domain/baixa-nf'
import type { ModoBaixaNf, PortaBaixaNf } from '@/modules/compels/application/baixar-nfs'
import { montarNotaDaTela, type NotaDaTela } from '../domain/tela'

/** A fila como a tela mostra (formato do repositório, sem depender dele aqui). */
export interface LinhaFilaTela {
  id: string
  notaId: number
  numero: number
  cliente: string
  status: string
  colocadoPorNome: string
  colocadoEm: string
  tentativas: number
  ultimaTentativaEm: string | null
  ultimaMensagem: string
  finalizadoEm: string | null
}

export interface DadosTelaBaixaNf {
  /** `indisponivel` = o Compels não respondeu: a tela avisa e não deixa confirmar. */
  compels: 'ok' | 'indisponivel' | 'nao_configurado'
  /** `false` = não deu para ler a fila (banco): a tela avisa e não deixa confirmar. */
  filaOk: boolean
  notas: NotaDaTela[]
  aguardando: LinhaFilaTela[]
  falhas: LinhaFilaTela[]
  /** O interruptor `COMPELS_BAIXA_NF`; `null` = baixa desligada (tela só leitura). */
  modo: ModoBaixaNf | null
}

export interface DependenciasTela {
  compels: Pick<PortaBaixaNf, 'listarNfsPendentes' | 'itensDaNf'> | null
  lerFila(): Promise<{ aguardando: LinhaFilaTela[]; falhas: LinhaFilaTela[] }>
  saldoPa(codigo: string): Promise<number | null>
  modo: ModoBaixaNf | null
}

/** Quantas notas o Compels lê ao mesmo tempo (3 consultas por nota). */
const PARALELO = 4

async function emLotes<T, R>(itens: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = []
  for (let i = 0; i < itens.length; i += n) saida.push(...(await Promise.all(itens.slice(i, i + n).map(f))))
  return saida
}

/**
 * Lê tudo o que a tela precisa: as notas pendentes do Compels (todas, sem data de corte; da mais antiga para a
 * mais nova), os itens de cada uma, o estoque do PA por código distinto (uma consulta por código) e a fila.
 */
export async function carregarTelaBaixaNf(deps: DependenciasTela): Promise<DadosTelaBaixaNf> {
  let fila: { aguardando: LinhaFilaTela[]; falhas: LinhaFilaTela[] } = { aguardando: [], falhas: [] }
  let filaOk = true
  try {
    fila = await deps.lerFila()
  } catch (e) {
    console.error('[faturamento] fila da baixa de NF não pôde ser lida:', e instanceof Error ? e.message : e)
    filaOk = false
  }
  const base = { filaOk, ...fila, modo: deps.modo, notas: [] as NotaDaTela[] }
  if (!deps.compels) return { ...base, compels: 'nao_configurado' }
  const compels = deps.compels

  try {
    const notas = ordenarPorEmissao(
      (await compels.listarNfsPendentes()).map(lerNota).filter((n): n is NotaPendente => n !== null),
    )
    const itens = await emLotes(notas, PARALELO, (n) => compels.itensDaNf(n.id))
    const codigos = new Set<string>()
    for (const i of itens) for (const l of i.proprias) {
      const c = codigoDaLinha(l)
      if (c) codigos.add(c)
    }
    const estoquePa = new Map<string, number | null>(
      await emLotes([...codigos], PARALELO, async (c) => [c, await deps.saldoPa(c)] as const),
    )
    const naFila = fila.aguardando.map((a) => a.notaId)
    return { ...base, compels: 'ok', notas: notas.map((n, k) => montarNotaDaTela(n, itens[k]!, estoquePa, naFila)) }
  } catch (e) {
    console.error('[faturamento] Compels indisponível na tela de baixa de NF:', e instanceof Error ? e.message : e)
    return { ...base, compels: 'indisponivel' }
  }
}
