import { CANAIS, type Canal } from '../domain/tipos'
import type { PortaCanal, PortasCanais } from '../application/portas'
import { criarTelegram } from './telegram'
import { criarDiscord } from './discord'
import { lerConfigEmail, criarEmail } from './email'

/** Quais canais este ambiente consegue usar (a tela mostra "não configurado" nos outros). */
export function canaisConfigurados(env: NodeJS.ProcessEnv = process.env): Record<Canal, boolean> {
  return {
    telegram: !!env.TELEGRAM_BOT_TOKEN,
    discord: !!env.DISCORD_BOT_TOKEN,
    email: lerConfigEmail(env) !== null,
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

  const configEmail = lerConfigEmail(env)
  if (configEmail) {
    const mail = criarEmail(configEmail)
    const porta: PortaCanal = {
      // O e-mail é só pessoa: "avisar no canal" é sempre o canal do Discord (0123), e o check
      // alerta_envios_email_so_pessoa da 0151 já impede a linha de canal nascer. Falha explícita
      // aqui é melhor que mandar e-mail para um endereço que por acaso é um id de canal.
      // Só dois parâmetros: o terceiro (ocorrenciaIdBotao) é o botão "Resolver", que e-mail não tem.
      enviar: (destino, texto) =>
        destino.tipo === 'usuario'
          ? mail.enviarMensagem(destino.externoId, texto)
          : Promise.resolve({ ok: false as const, erro: 'E-mail não avisa em canal, só por mensagem direta.' }),
      // E-mail enviado não se edita e nenhuma mensagem de e-mail nasce com botão, então não há nada
      // a remover — devolver ok evita que `removerBotoesDaOcorrencia` tente de novo a cada rodada.
      removerBotoes: () => Promise.resolve({ ok: true as const }),
    }
    portas.email = porta
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

/**
 * O aviso EM CANAL está configurado? Precisa de DUAS coisas: o token do bot e o DISCORD_CANAL_ID.
 * Não é o mesmo que `canaisConfigurados().discord`, que só olha o token e vale para a conversa
 * privada — com o token e sem o id, uma regra que avisa só no canal não avisa ninguém, e o lembrete
 * também não salva (a abertura renova o `ultimo_envio_em`). Daqui sai o "(não configurado)" da
 * opção "No canal do Discord" e a recusa da validação.
 */
export function canalDiscordConfigurado(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.DISCORD_BOT_TOKEN && canalDiscordDoSistema(env) !== null
}

/** Nome dos canais configurados, para a mensagem da tela. */
export function listaCanaisConfigurados(env: NodeJS.ProcessEnv = process.env): Canal[] {
  const mapa = canaisConfigurados(env)
  return CANAIS.filter((c) => mapa[c])
}
