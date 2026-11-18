/**
 * A baixa automática de NF (`POST /api/compels/baixa-nf`) NÃO passa pela sessão do app: quem autoriza é o
 * segredo `ESTOQUE_CRON_SECRET`, conferido dentro da própria rota (crontab da instância). Mesma regra da fila de
 * estoque (`rotas-estoque.ts`): sem esta saída no `middleware.ts` o pedido levaria redirect pro /login e o
 * `curl -f` do cron trataria isso como sucesso. Rota EXATA (tolera uma barra final).
 */
const ROTA_BAIXA_NF = '/api/compels/baixa-nf'

export function ehRotaDaBaixaDeNf(pathname: string): boolean {
  return pathname === ROTA_BAIXA_NF || pathname === `${ROTA_BAIXA_NF}/`
}
