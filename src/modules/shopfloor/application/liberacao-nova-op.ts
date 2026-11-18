export interface Ambiente {
  vercel?: string // VERCEL_ENV: 'preview' | 'development' | 'production' (só existe na Vercel)
  node?: string   // NODE_ENV
}

/** Preview da Vercel ou `npm run dev`: não é produção, a tela nova fica sempre visível. */
function foraDeProducao(amb: Ambiente): boolean {
  if (amb.vercel === 'preview' || amb.vercel === 'development') return true
  return amb.node === 'development'
}

/** Está na lista (`a@x,b@y` ou `*`)? Vazia ou ausente = ninguém. Sem olhar o ambiente. */
function estaNaLista(email: string | null | undefined, listaEnv: string | undefined): boolean {
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

/**
 * Lançamento escondido da tela Nova OP (`/shopfloor/ordens/nova`), SÓ em produção: lá, só os e-mails de
 * `NOVA_OP_LIBERADA_PARA` (separados por vírgula) usam a tela nova; os demais seguem no cadastro antigo
 * (OrdemForm). `*` = todos (é assim que se libera de vez). Vazia ou ausente = NINGUÉM: esquecer a variável
 * no deploy não pode expor a tela. No preview da Vercel e no dev local a tela aparece sempre.
 */
export function novaOpLiberada(
  email: string | null | undefined,
  listaEnv: string | undefined = process.env.NOVA_OP_LIBERADA_PARA,
  ambiente: Ambiente = { vercel: process.env.VERCEL_ENV, node: process.env.NODE_ENV },
): boolean {
  if (foraDeProducao(ambiente)) return true
  return estaNaLista(email, listaEnv)
}
