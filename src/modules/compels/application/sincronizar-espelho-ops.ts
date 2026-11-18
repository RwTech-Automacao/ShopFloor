import type { OpEspelhoLida } from '../domain/espelho-ops'
import { nomeDoNegociante } from '../domain/negociante'

export interface ContagemEspelho { novas: number; atualizadas: number; inativadas: number }

/**
 * Uma rodada do espelho: lê a lista inteira de OPs ativas e grava de uma vez. Lista vazia nunca é gravada.
 * Com `nomeCliente`, o código do negociante vira o nome do cliente (uma consulta por código distinto); se a
 * consulta de um código falhar, fica o código — a rodada nunca cai por isso.
 */
export async function sincronizarEspelhoOps(p: {
  listar: () => Promise<OpEspelhoLida[]>
  gravar: (ops: OpEspelhoLida[]) => Promise<ContagemEspelho>
  nomeCliente?: (codigo: string) => Promise<string>
}): Promise<ContagemEspelho & { lidas: number }> {
  let ops = await p.listar()
  if (ops.length === 0) throw new Error('O Compels devolveu a lista de OPs vazia: nada foi gravado.')
  if (p.nomeCliente) {
    const nomes = new Map<string, string>()
    for (const codigo of new Set(ops.map((o) => o.cliente).filter((c) => c !== ''))) {
      try { nomes.set(codigo, await p.nomeCliente(codigo)) } catch { /* fica o código */ }
    }
    ops = ops.map((o) => ({ ...o, cliente: nomes.get(o.cliente) ?? o.cliente }))
  }
  return { lidas: ops.length, ...(await p.gravar(ops)) }
}

const SEIS_HORAS_MS = 6 * 60 * 60 * 1000

/**
 * Código do negociante → nome do cliente, com cache no processo (a rodada é de 10 em 10 min; o cadastro de
 * cliente quase não muda). Sem cadastro com nome: fica o código (guardado também). Consulta que falha: fica o
 * código, vai para o log e não é guardada — a próxima rodada tenta de novo.
 */
export function criarNomesDeClientes(p: {
  buscar: (codigo: string) => Promise<unknown>
  agora?: () => number
  ttlMs?: number
  avisar?: (mensagem: string) => void
}): (codigo: string) => Promise<string> {
  const agora = p.agora ?? Date.now
  const ttl = p.ttlMs ?? SEIS_HORAS_MS
  const avisar = p.avisar ?? ((m: string) => console.warn(m))
  const cache = new Map<string, { nome: string; ate: number }>()
  return async (codigo) => {
    const guardado = cache.get(codigo)
    if (guardado && agora() < guardado.ate) return guardado.nome
    try {
      const nome = nomeDoNegociante(await p.buscar(codigo), codigo) ?? codigo
      cache.set(codigo, { nome, ate: agora() + ttl })
      return nome
    } catch (e) {
      avisar(`[espelho-ops] nome do cliente ${codigo} não lido (fica o código): ${e instanceof Error ? e.message : String(e)}`)
      return codigo
    }
  }
}
