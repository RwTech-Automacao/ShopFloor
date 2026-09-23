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
      // O Telegram é só conversa privada (spec 2026-09-23: "O Telegram: continua só na conversa
      // privada"). Linha de canal no Telegram só apareceria por engano, e falha explícita é melhor
      // do que uma mensagem mandada para um chat_id que por acaso existe.
      enviar: (destino, texto, botao) =>
        destino.tipo === 'usuario'
          ? tg.enviarMensagem(destino.externoId, texto, botao)
          : Promise.resolve({ ok: false as const, erro: 'Telegram não avisa em canal, só na conversa privada.' }),
      removerBotoes: (id) => tg.removerBotoes(id),
    }
    portas.telegram = porta
  }

  const tokenDiscord = env.DISCORD_BOT_TOKEN
  if (tokenDiscord) {
    const dc = criarDiscord({ token: tokenDiscord })
    const porta: PortaCanal = {
      enviar: (destino, texto, botao) =>
        destino.tipo === 'canal'
          ? dc.enviarCanal(destino.externoId, texto, botao)
          : dc.enviarDm(destino.externoId, texto, botao),
      removerBotoes: (id) => dc.removerBotoes(id),
    }
    portas.discord = porta
  }

  return portas
}

/**
 * O canal do Discord onde a regra com `avisar_canal` posta (DISCORD_CANAL_ID). Vazio ou ausente =
 * este ambiente não tem canal: `alerta_avaliar` não enfileira nada de canal (e quem tem
 * `avisar_pessoas` continua sendo avisado no privado).
 */
export function canalDiscordDoSistema(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = (env.DISCORD_CANAL_ID ?? '').trim()
  return id === '' ? null : id
}

/** Nome dos canais configurados, para a mensagem da tela. */
export function listaCanaisConfigurados(env: NodeJS.ProcessEnv = process.env): Canal[] {
  const mapa = canaisConfigurados(env)
  return CANAIS.filter((c) => mapa[c])
}
