#!/usr/bin/env node
// Configura os bots dos alertas: webhook do Telegram + comando /vincular no servidor do Discord.
// Uso (na máquina que tem as variáveis do ambiente):
//   node tools/alertas/configurar-bots.mjs
//   node tools/alertas/configurar-bots.mjs --so-telegram
//   node tools/alertas/configurar-bots.mjs --so-discord
//
// NUNCA imprime token nem segredo: só diz o que deu certo e o que falhou.

const args = new Set(process.argv.slice(2))
const soTelegram = args.has('--so-telegram')
const soDiscord = args.has('--so-discord')

const env = process.env
const BASE = (env.ALERTAS_BASE_URL ?? 'https://shopfloor.enterplak.com.br').replace(/\/+$/, '')

function exigir(nomes) {
  const faltando = nomes.filter((n) => !env[n])
  if (faltando.length > 0) {
    console.error(`Variáveis ausentes: ${faltando.join(', ')}`)
    return false
  }
  return true
}

async function configurarTelegram() {
  if (!exigir(['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET'])) return false
  const url = `${BASE}/api/alertas/telegram`
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      secret_token: env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: true,
    }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.ok !== true) {
    console.error(`Telegram setWebhook falhou (${res.status}): ${json?.description ?? 'sem descrição'}`)
    return false
  }
  console.log(`Telegram: webhook apontado para ${url}`)
  if (env.TELEGRAM_BOT_USERNAME) console.log(`Telegram: bot https://t.me/${env.TELEGRAM_BOT_USERNAME}`)
  return true
}

async function configurarDiscord() {
  if (!exigir(['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID', 'DISCORD_GUILD_ID'])) return false
  const comandos = [
    {
      name: 'vincular',
      description: 'Vincula seu Discord ao ShopFloor para receber os alertas',
      type: 1,
      options: [
        {
          name: 'codigo',
          description: 'O código gerado em Meu perfil (ex.: ALERTA-7K3M)',
          type: 3,
          required: true,
        },
      ],
    },
  ]
  const res = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(comandos),
    },
  )
  if (!res.ok) {
    const json = await res.json().catch(() => null)
    console.error(`Discord: registro do /vincular falhou (${res.status}): ${json?.message ?? 'sem descrição'}`)
    return false
  }
  console.log('Discord: comando /vincular registrado no servidor')
  console.log(`Discord: confira no portal se o Interactions Endpoint URL é ${BASE}/api/alertas/discord`)
  return true
}

const tarefas = []
if (!soDiscord) tarefas.push(configurarTelegram())
if (!soTelegram) tarefas.push(configurarDiscord())
const resultados = await Promise.all(tarefas)
process.exit(resultados.every(Boolean) ? 0 : 1)
