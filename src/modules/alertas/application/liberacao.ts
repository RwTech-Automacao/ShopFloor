/**
 * Lançamento escondido dos Alertas em produção: enquanto `ALERTAS_LIBERADO_PARA` não estiver
 * vazia, só os e-mails da lista (ou `*`, todos) veem e acessam as telas e ações de Alertas.
 * Vazia ou ausente = todos — é assim que se libera de vez, só removendo a variável.
 */
export function alertasLiberados(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.ALERTAS_LIBERADO_PARA,
): boolean {
  const lista = (listaEnv ?? '').trim()
  if (lista === '') return true

  const emails = lista
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (emails.includes('*')) return true

  const alvo = (email ?? '').trim().toLowerCase()
  if (!alvo) return false
  return emails.includes(alvo)
}
