import type { AbaPlanilha } from '../domain/planilha'

/**
 * A planilha "Peças em garantia" está aberta a "qualquer pessoa com o link": cada aba é lida pelo export CSV,
 * sem credencial (spec 2026-11-17-sat-entrada-design.md, decisão 3). Só leitura — nunca escreve na planilha.
 * `SAT_PLANILHA_ID` e `SAT_PLANILHA_GIDS` (`gid` ou `gid:nome`, separados por vírgula, NA ORDEM DE PRIORIDADE)
 * trocam a planilha e as abas; sem elas, as 3 abas abaixo.
 */
export const PLANILHA_PADRAO = '1hxWo_2hvi4Mv8VXHhBNdO_2xcUEekiBscstJk0GhIZM'

export const ABAS_PADRAO: AbaPlanilha[] = [
  { gid: '2133071592', nome: 'Garantia 2026 - Automação' },
  { gid: '1388582578', nome: 'Garantia 2025' },
  { gid: '1801872756', nome: 'Garantia 2025/2024' },
]

const TEMPO_LIMITE_MS = 30_000

export function configPlanilha(env: Record<string, string | undefined> = process.env): { planilhaId: string; abas: AbaPlanilha[] } {
  const planilhaId = (env.SAT_PLANILHA_ID ?? '').trim() || PLANILHA_PADRAO
  if (!/^[A-Za-z0-9_-]+$/.test(planilhaId)) throw new Error('SAT_PLANILHA_ID inválido.')
  const lista = (env.SAT_PLANILHA_GIDS ?? '').trim()
  if (lista === '') return { planilhaId, abas: ABAS_PADRAO }
  const abas = lista.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
    const [gid, ...nome] = p.split(':')
    const g = (gid ?? '').trim()
    if (!/^\d+$/.test(g)) throw new Error('SAT_PLANILHA_GIDS inválido.')
    const n = nome.join(':').trim()
    return { gid: g, nome: n || ABAS_PADRAO.find((a) => a.gid === g)?.nome || `aba ${g}` }
  })
  return { planilhaId, abas }
}

export function urlDaAba(planilhaId: string, gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${planilhaId}/export?format=csv&gid=${gid}`
}

/** O CSV de uma aba. Página HTML no lugar do CSV = a planilha deixou de ser pública (o Google pede login). */
export async function baixarAba(planilhaId: string, gid: string, f: typeof fetch = fetch): Promise<string> {
  const res = await f(urlDaAba(planilhaId, gid), {
    redirect: 'follow', cache: 'no-store', signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  })
  if (!res.ok) throw new Error(`export da aba ${gid}: HTTP ${res.status}`)
  const texto = await res.text()
  const tipo = res.headers.get('content-type') ?? ''
  if (tipo.includes('text/html') || /^\s*</.test(texto)) {
    throw new Error(`export da aba ${gid} veio em HTML: a planilha não está pública ("qualquer pessoa com o link")`)
  }
  return texto
}
