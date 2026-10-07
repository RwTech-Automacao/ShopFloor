/**
 * Valor do `frame-ancestors` das páginas /embed (quem pode embuti-las em iframe).
 * Função pura: recebe as variáveis, não lê process.env.
 *
 * Falha FECHANDO: sem nenhuma origem configurada devolve 'self' (ninguém de fora embute).
 */
export interface EnvFrameAncestors {
  EMBED_FRAME_ANCESTORS?: string;
  DASHBOARD_ORIGIN?: string;
}

function limpar(valor: string | undefined): string {
  return (valor ?? "").trim().split(/\s+/).filter(Boolean).join(" ");
}

export function frameAncestorsEmbed(env: EnvFrameAncestors): string {
  return limpar(env.EMBED_FRAME_ANCESTORS) || limpar(env.DASHBOARD_ORIGIN) || "'self'";
}
