export interface RegistroContagem {
  posto: string
  status: string
}

/** Contagem por posto (fluxo da OP + Manutenção): sem-status conta registros; com-status conta aprovados. */
export function contarPorPosto(
  postosDaOp: string[],
  registros: RegistroContagem[],
  temStatus: (posto: string) => boolean,
): Record<string, number> {
  const colunas = [...postosDaOp, 'Manutenção']
  const contagens: Record<string, number> = {}
  for (const p of colunas) contagens[p] = 0
  for (const r of registros) {
    const coluna = colunas.find((c) => c.toLowerCase() === r.posto.toLowerCase())
    if (!coluna) continue
    if (temStatus(coluna)) {
      if (r.status.toLowerCase() === 'aprovado') contagens[coluna] = (contagens[coluna] ?? 0) + 1
    } else {
      contagens[coluna] = (contagens[coluna] ?? 0) + 1
    }
  }
  return contagens
}
