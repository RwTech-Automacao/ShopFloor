/**
 * Os links absolutos que as mensagens dos alertas levam para as telas de relatório. A mensagem sai pelo
 * cron (sem request nenhum), então a origem não dá para descobrir: vem da variável SHOPFLOOR_URL, e na
 * falta dela, do endereço de produção.
 */
export const SHOPFLOOR_URL_PADRAO = 'https://shopfloor.enterplak.com.br'

/**
 * A origem do ShopFloor, sem barra no fim. Vazio, só espaço ou algo que não é http(s) vira o padrão:
 * um link quebrado na mensagem é pior que um link para produção (o leitor ainda chega à tela certa).
 */
export function baseDoShopfloor(valor: string | null | undefined): string {
  const limpo = (valor ?? '').trim().replace(/\/+$/, '')
  if (!/^https?:\/\/[^\s/]+/i.test(limpo)) return SHOPFLOOR_URL_PADRAO
  return limpo
}

/** O relatório "Peças paradas" de UMA regra: /shopfloor/analisar/parados?regra=<id>. */
export function urlRelatorioParados(base: string, regraId: string): string {
  return `${base}/shopfloor/analisar/parados?regra=${encodeURIComponent(regraId)}`
}

/** O relatório de UMA EMB: /recebimento/emb/<emb>. */
export function urlRelatorioEmb(base: string, emb: string): string {
  return `${base}/recebimento/emb/${encodeURIComponent(emb.trim())}`
}

/** A linha que as mensagens levam no fim da lista. */
export function linhaVerRelatorio(url: string): string {
  return `Ver relatório completo: ${url}`
}
