import { CANAIS, type Canal } from '../domain/tipos'
import type { PortaCanal, PortasCanais } from '../application/portas'
import { criarTelegram } from './telegram'
import { criarDiscord } from './discord'

/** Quais canais este ambiente consegue usar (a tela mostra "não configurado" nos outros). */
export function canaisConfigurados(env: NodeJS.ProcessEnv = process.env): Record<Canal, boolean> {
  return {
    telegram: !!env.TELEGRAM_BOT_TOKEN,
    discord: !!env.DISCORD_BOT_TOKEN,
  }
}

/** Monta as portas dos canais configurados. Canal ausente = o serviço simplesmente pula. */
export function criarPortasCanais(env: NodeJS.ProcessEnv = process.env): PortasCanais {
  const portas: PortasCanais = {}

  const tokenTelegram = env.TELEGRAM_BOT_TOKEN
  if (tokenTelegram) {
    const tg = criarTelegram({ token: tokenTelegram })
    const porta: PortaCanal = {
      enviar: (externoId, texto, botao) => tg.enviarMensagem(externoId, texto, botao),
      removerBotoes: (id) => tg.removerBotoes(id),
    }
    portas.telegram = porta
  }

  const tokenDiscord = env.DISCORD_BOT_TOKEN
  if (tokenDiscord) {
    const dc = criarDiscord({ token: tokenDiscord })
    const porta: PortaCanal = {
      enviar: (externoId, texto, botao) => dc.enviarDm(externoId, texto, botao),
      removerBotoes: (id) => dc.removerBotoes(id),
    }
    portas.discord = porta
  }

  return portas
}

/** Nome dos canais configurados, para a mensagem da tela. */
export function listaCanaisConfigurados(env: NodeJS.ProcessEnv = process.env): Canal[] {
  const mapa = canaisConfigurados(env)
  return CANAIS.filter((c) => mapa[c])
}
