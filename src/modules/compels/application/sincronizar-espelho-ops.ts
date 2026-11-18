import type { OpEspelhoLida } from '../domain/espelho-ops'

export interface ContagemEspelho { novas: number; atualizadas: number; inativadas: number }

/** Uma rodada do espelho: lê a lista inteira de OPs ativas e grava de uma vez. Lista vazia nunca é gravada. */
export async function sincronizarEspelhoOps(p: {
  listar: () => Promise<OpEspelhoLida[]>
  gravar: (ops: OpEspelhoLida[]) => Promise<ContagemEspelho>
}): Promise<ContagemEspelho & { lidas: number }> {
  const ops = await p.listar()
  if (ops.length === 0) throw new Error('O Compels devolveu a lista de OPs vazia: nada foi gravado.')
  return { lidas: ops.length, ...(await p.gravar(ops)) }
}
