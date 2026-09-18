# Alertas de taxa de aprovação — criar os bots e ligar tudo

O ShopFloor manda os alertas direto pelo **bot do Telegram** e pelo **bot do Discord** da empresa
(sem n8n). Este documento é o passo a passo de quem configura pela primeira vez.

## 1. Bot do Telegram

1. No Telegram, fale com o **@BotFather** → `/newbot`.
2. Nome sugerido: `Enterplak ShopFloor`; usuário: algo terminando em `bot` (ex.: `enterplak_shopfloor_bot`).
3. O BotFather devolve o **token**. Guarde em `TELEGRAM_BOT_TOKEN` (nunca no repositório).
4. Guarde o usuário do bot (sem o `@`) em `TELEGRAM_BOT_USERNAME` — é o link que aparece na tela Meu perfil.
5. Invente um segredo grande para `TELEGRAM_WEBHOOK_SECRET` (ex.: `openssl rand -hex 24`).

## 2. Bot do Discord

1. Abra o **Discord Developer Portal** → **New Application** (nome: `Enterplak ShopFloor`).
2. Em **General Information**, copie o **Application ID** → `DISCORD_APP_ID` e a
   **Public Key** → `DISCORD_PUBLIC_KEY`.
3. Em **Bot**, clique em **Reset Token** e guarde o token → `DISCORD_BOT_TOKEN`.
4. Em **OAuth2 → URL Generator**, marque os escopos `bot` e `applications.commands`
   (permissão de bot: nenhuma além do padrão — as mensagens são DMs). Abra a URL gerada e
   **convide o bot** para o servidor da Enterplak.
5. Pegue o ID do servidor (Discord → Configurações → Avançado → Modo desenvolvedor; clique com o
   botão direito no servidor → Copiar ID do servidor) → `DISCORD_GUILD_ID`.
6. Em **General Information → Interactions Endpoint URL**, coloque
   `https://shopfloor.enterplak.com.br/api/alertas/discord` e salve. O Discord manda um PING
   assinado na hora: se a URL estiver no ar com a `DISCORD_PUBLIC_KEY` certa, ele aceita.
7. **Importante:** cada pessoa precisa estar no servidor e aceitar DM de membros do servidor,
   senão o Discord recusa a mensagem privada. O botão **Enviar teste** em *Meu perfil* mostra isso
   na hora.

## 3. Variáveis do ambiente

No `.env.production` da Lightsail (e, para testar, no `.env.local` ou no Preview da Vercel):

```
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_WEBHOOK_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_APP_ID=
DISCORD_PUBLIC_KEY=
DISCORD_GUILD_ID=
ALERTAS_CRON_SECRET=
```

`SUPABASE_SERVICE_ROLE_KEY` já existe e é usada pelas rotas de cron/webhook.

Depois de mudar variáveis: `pm2 restart shopfloor --update-env`.

## 4. Registrar webhook e comando

```bash
cd ~/ShopFloor
node tools/alertas/configurar-bots.mjs            # Telegram + Discord
node tools/alertas/configurar-bots.mjs --so-telegram
node tools/alertas/configurar-bots.mjs --so-discord
```

O script lê as variáveis do ambiente e **nunca imprime token**. Em outro domínio (preview), use
`ALERTAS_BASE_URL=https://meu-preview.vercel.app node tools/alertas/configurar-bots.mjs`.

## 5. Crontab (avaliação a cada 5 minutos)

O segredo **não** vai escrito na linha do crontab: fica num arquivo só do dono, com permissão
**600** (nunca cole `ALERTAS_CRON_SECRET` direto no `crontab -e`).

```bash
umask 077
printf '%s\n' "$ALERTAS_CRON_SECRET" > ~/.alertas-cron-secret
chmod 600 ~/.alertas-cron-secret
crontab -e
```

Linha a acrescentar:

```
*/5 * * * * curl -fsS -m 60 -X POST -H "Authorization: Bearer $(cat ~/.alertas-cron-secret)" https://shopfloor.enterplak.com.br/api/alertas/avaliar >> ~/alertas.log 2>&1
```

Com o **RDS desligado** (19:00–06:00 do plano de economia) a rota responde **503** e o log registra
— nada mais acontece. Isso é esperado, não é um alarme.

## 6. Migrações

A `0113` cria as tabelas/funções dos alertas; a `0114` cria o índice de `sf_registros` usado pelas
janelas de avaliação. São aplicadas separadamente, com métodos diferentes por ambiente:

### Dev (Supabase cloud)

Ambas pelo **SQL Editor** do Supabase, colando o conteúdo do arquivo:

- `supabase/migrations/0113_alertas.sql` — cola e roda direto.
- `supabase/migrations/0114_sf_registros_posto_data_idx.sql` — **remova a palavra `concurrently`**
  antes de rodar (o SQL Editor executa dentro de uma transação implícita, e `create index
  concurrently` não roda em transação).

### Prod (RDS, via `psql` na instância Lightsail)

O `.pgpass` da instância está com a senha antiga, então a autenticação por arquivo falha; force a
senha interativa com `-W` e desligue o `.pgpass` apontando `PGPASSFILE` para `/dev/null`. Force
também `PGCLIENTENCODING=UTF8` (evita mensagem de erro do Postgres em encoding errado no terminal).

```bash
# 0113: aplica dentro de UMA transação (-1) e para no primeiro erro.
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W \
  "host=shopfloor-prod-db... user=postgres sslmode=require" \
  -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0113_alertas.sql

# 0114: SEPARADA e SEM -1 — create index concurrently não roda dentro de transação.
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W \
  "host=shopfloor-prod-db... user=postgres sslmode=require" \
  -v ON_ERROR_STOP=1 -f supabase/migrations/0114_sf_registros_posto_data_idx.sql

cd ~/supabase/docker && docker compose restart rest   # recarrega o schema do PostgREST
```

Depois de qualquer uma das duas: `docker compose restart rest` (ou `notify pgrst, 'reload
schema';`, que a própria 0113 já executa na última linha).

## 7. Conferir

- `curl -i -X POST https://shopfloor.enterplak.com.br/api/alertas/avaliar` → **401** (sem segredo).
- Com o segredo → `{"avaliadas":N,"enviados":0,"falhas":0,"ocupado":false}`.
- `https://api.telegram.org/bot<token>/getWebhookInfo` → a URL e `has_custom_certificate:false`
  (rode no seu terminal, não em log compartilhado).
- Tela **Meu perfil** → Vincular → o bot responde.
