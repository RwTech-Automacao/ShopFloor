/** Catálogo de abas do Fluxo (Operação/Análise) — fonte única pros layouts, o menu e o setup do kiosk. */
export interface AbaFluxo {
  rotulo: string
  href: string
}

export const ABAS_OPERAR: AbaFluxo[] = [
  { rotulo: 'Lançamento', href: '/shopfloor/operar/lancamento' },
  { rotulo: 'Consultar Integração', href: '/shopfloor/operar/integracao' },
  { rotulo: 'Manutenção', href: '/shopfloor/operar/manutencao' },
]

export const ABAS_ANALISE: AbaFluxo[] = [
  { rotulo: 'Dashboard', href: '/shopfloor/analisar/dashboard' },
  { rotulo: 'Pesquisa', href: '/shopfloor/analisar/pesquisa' },
  { rotulo: 'Burn-in', href: '/shopfloor/analisar/burn-in' },
  { rotulo: 'Caixas', href: '/shopfloor/analisar/caixas' },
  { rotulo: 'Cancelamentos', href: '/shopfloor/analisar/cancelamentos' },
  { rotulo: 'Repinmetro', href: '/shopfloor/analisar/repinmetro' },
]

/** Todas as abas selecionáveis no setup do kiosk, agrupadas por seção. */
export const ABAS_KIOSK: { secao: string; abas: AbaFluxo[] }[] = [
  { secao: 'Operação', abas: ABAS_OPERAR },
  { secao: 'Análise', abas: ABAS_ANALISE },
]

/** Lista achatada (todas as abas) — usada pela barra única do kiosk (navega entre seções). */
export const TODAS_ABAS: AbaFluxo[] = [...ABAS_OPERAR, ...ABAS_ANALISE]

/** A rota atual está entre as abas permitidas? (casa exata ou sub-rota). */
export function abaPermitida(pathname: string, abas: string[]): boolean {
  return abas.some((a) => pathname === a || pathname.startsWith(a + '/'))
}
