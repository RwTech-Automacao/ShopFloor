/**
 * O espelho das OPs do Compels (`POST /api/compels/espelho-ops`) NÃO passa pela sessão do app: quem autoriza é o
 * segredo `ESTOQUE_CRON_SECRET`, conferido dentro da própria rota (crontab da instância). Mesma regra da baixa de
 * NF e da planilha do SAT: sem esta saída no `middleware.ts` o pedido levaria redirect pro /login e o `curl -f` do
 * cron trataria isso como sucesso. Rota EXATA (tolera uma barra final).
 */
const ROTA_ESPELHO = '/api/compels/espelho-ops'

export function ehRotaDoEspelhoDeOps(pathname: string): boolean {
  return pathname === ROTA_ESPELHO || pathname === `${ROTA_ESPELHO}/`
}
