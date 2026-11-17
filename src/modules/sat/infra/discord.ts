import 'server-only'
import { criarDiscord } from '@/modules/alertas/infra/discord'
import { canalDiscordDoSistema } from '@/modules/alertas/infra/canais'

/**
 * Aviso do SAT no Discord (mesmo bot dos Alertas): canal `SAT_DISCORD_CANAL_ID`, senão o do sistema
 * (`DISCORD_CANAL_ID`). Sem bot ou sem canal, nada. NUNCA lança: falha no Discord não impede a gravação.
 */
export async function avisarSat(texto: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  try {
    const token = env.DISCORD_BOT_TOKEN ?? ''
    const canal = (env.SAT_DISCORD_CANAL_ID ?? '').trim() || canalDiscordDoSistema(env)
    if (!token || !canal) return
    const r = await criarDiscord({ token }).enviarCanal(canal, texto, null)
    if (!r.ok) console.error('[sat] aviso no Discord falhou:', r.erro)
  } catch (e) {
    console.error('[sat] aviso no Discord falhou:', e instanceof Error ? e.message : e)
  }
}
