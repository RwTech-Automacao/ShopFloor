/**
 * A fila de estoque do Compels (`POST /api/shopfloor/estoque`) NÃO passa pela sessão do app: quem
 * autoriza é o segredo `ESTOQUE_CRON_SECRET`, conferido dentro da própria rota. É chamada pelo
 * crontab da instância (ver tools/estoque/README.md).
 *
 * ⚠️ Sem esta saída no `middleware.ts` a rota nunca executaria: o pedido levaria um redirect pro
 * /login, e o `curl -f` do cron não trata 3xx como falha — o log diria que a rodada correu bem
 * sem que nada tivesse sido enviado.
 *
 * Tolera UMA barra final (`/api/shopfloor/estoque/`), porque um cron com a barra a mais não pode
 * falhar em silêncio. É a rota EXATA: `/api/shopfloor/estoque-x` e `/api/shopfloor/estoque/x` não
 * são — rota nova sob o mesmo prefixo nasce COM sessão.
 */
const ROTA_FILA_DE_ESTOQUE = '/api/shopfloor/estoque'

export function ehRotaDaFilaDeEstoque(pathname: string): boolean {
  return pathname === ROTA_FILA_DE_ESTOQUE || pathname === `${ROTA_FILA_DE_ESTOQUE}/`
}
