/**
 * A sincronização da planilha do SAT (`POST /api/sat/sincronizar-planilha`) NÃO passa pela sessão do app: quem
 * autoriza é o segredo `ESTOQUE_CRON_SECRET`, conferido dentro da própria rota (crontab da instância). Mesma
 * regra da baixa de NF (`rotas-baixa-nf.ts`): sem esta saída no `middleware.ts` o pedido levaria redirect pro
 * /login e o `curl -f` do cron trataria isso como sucesso. Rota EXATA (tolera uma barra final).
 */
const ROTA_SINCRONIZACAO = '/api/sat/sincronizar-planilha'

export function ehRotaDaSincronizacaoSat(pathname: string): boolean {
  return pathname === ROTA_SINCRONIZACAO || pathname === `${ROTA_SINCRONIZACAO}/`
}
