export interface Ambiente {
  vercel?: string // VERCEL_ENV: 'preview' | 'development' | 'production' (só existe na Vercel)
  node?: string   // NODE_ENV
}

/** Preview da Vercel ou `npm run dev`: não é produção, os Alertas ficam sempre visíveis. */
function foraDeProducao(amb: Ambiente): boolean {
  if (amb.vercel === 'preview' || amb.vercel === 'development') return true
  return amb.node === 'development'
}

/**
 * Lançamento escondido dos Alertas SÓ em produção (AWS): lá, só os e-mails de
 * `ALERTAS_LIBERADO_PARA` veem e acessam as telas e ações de Alertas. `*` = todos (é assim que se
 * libera de vez). Vazia ou ausente = NINGUÉM: esquecer a variável no deploy não pode expor a feature.
 * No preview da Vercel e no dev local a feature aparece sempre (é onde se testa).
 */
export function alertasLiberados(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.ALERTAS_LIBERADO_PARA,
  ambiente: Ambiente = { vercel: process.env.VERCEL_ENV, node: process.env.NODE_ENV },
): boolean {
  if (foraDeProducao(ambiente)) return true

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
