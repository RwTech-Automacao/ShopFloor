export interface ReprovaRow {
  dataHora: string
  cliente: string
  pmo: string
  op: string
  sn: string
  snNorm: string
  posto: string
  cod: string
  pos: string
  tipo: string
}

export interface ReparoRow {
  pmo: string
  op: string
  snNorm: string
  postoOrigem: string
  dataHoraOrigem: string | null
}

export interface Ocorrencia {
  dataHora: string
  cliente: string
  pmo: string
  op: string
  sn: string
  posto: string
  cod: string
  tipo: string
  posicoes: string[]
  status: 'Pendente' | 'Concluída'
}

/**
 * Agrupa reprovas por ocorrência (pmo|op|sn|posto|data/hora), agrega posições e
 * marca Concluída quando existe reparo casando com a ocorrência (posto de origem
 * + data/hora de origem). Ordenado da mais recente para a mais antiga.
 */
export function agruparPendencias(reprovas: ReprovaRow[], reparos: ReparoRow[]): Ocorrencia[] {
  const reparados = new Set(
    reparos
      .filter((r) => r.dataHoraOrigem !== null && r.dataHoraOrigem !== '')
      .map((r) => [r.pmo, r.op, r.snNorm, r.postoOrigem.toLowerCase(), r.dataHoraOrigem].join('|')),
  )

  const ocorrencias = new Map<string, Ocorrencia>()
  for (const r of reprovas) {
    const chave = [r.pmo, r.op, r.snNorm, r.posto.toLowerCase(), r.dataHora].join('|')
    let item = ocorrencias.get(chave)
    if (!item) {
      item = {
        dataHora: r.dataHora,
        cliente: r.cliente,
        pmo: r.pmo,
        op: r.op,
        sn: r.sn,
        posto: r.posto,
        cod: r.cod,
        tipo: r.tipo,
        posicoes: [],
        status: reparados.has(chave) ? 'Concluída' : 'Pendente',
      }
      ocorrencias.set(chave, item)
    }
    const pos = r.pos.trim()
    if (pos !== '' && !item.posicoes.includes(pos)) item.posicoes.push(pos)
    if (item.cod === '' && r.cod !== '') item.cod = r.cod
    if (item.tipo === '' && r.tipo !== '') item.tipo = r.tipo
  }

  return [...ocorrencias.values()].sort((a, b) => (a.dataHora < b.dataHora ? 1 : -1))
}
