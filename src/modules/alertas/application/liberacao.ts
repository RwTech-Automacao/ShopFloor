/**
 * Lançamento escondido dos Alertas em produção: só os e-mails de `ALERTAS_LIBERADO_PARA` veem e
 * acessam as telas e ações de Alertas. `*` = todos (é assim que se libera de vez).
 * Vazia ou ausente = NINGUÉM: esquecer a variável no deploy não pode expor a feature.
 */
export function alertasLiberados(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.ALERTAS_LIBERADO_PARA,
): boolean {
  const lista = (listaEnv ?? '').trim()
  if (lista === '') return false

  const emails = lista
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (emails.includes('*')) return true

  const alvo = (email ?? '').trim().toLowerCase()
  if (!alvo) return false
  return emails.includes(alvo)
}
