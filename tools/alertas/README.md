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
ALERTAS_LIBERADO_PARA=
```

`SUPABASE_SERVICE_ROLE_KEY` já existe e é usada pelas rotas de cron/webhook.

`ALERTAS_LIBERADO_PARA` é o lançamento escondido em produção — ver seção 8 abaixo.

Depois de mudar variáveis: `pm2 restart shopfloor --update-env`.

## 4. Registrar webhook e comando

O script lê as variáveis de `process.env` e **não carrega `.env` sozinho**: passe o arquivo com
`--env-file` (precisa de **Node ≥ 20.6**; confira com `node -v`).

```bash
cd ~/ShopFloor
node --env-file=.env.production tools/alertas/configurar-bots.mjs                # Telegram + Discord
node --env-file=.env.production tools/alertas/configurar-bots.mjs --so-telegram
node --env-file=.env.production tools/alertas/configurar-bots.mjs --so-discord
```

O script **nunca imprime token**. Em outro domínio (preview), use
`ALERTAS_BASE_URL=https://meu-preview.vercel.app node --env-file=.env.local tools/alertas/configurar-bots.mjs`.

### Preview da Vercel: Deployment Protection

O preview da Vercel vem com **Deployment Protection** ligada: toda requisição sem login da Vercel
recebe a tela de autenticação — inclusive os webhooks do Telegram e do Discord, que então nunca
chegam no app (e o Discord recusa salvar a *Interactions Endpoint URL*). Para o smoke:

- **Desligue** a proteção só para o preview (*Project → Settings → Deployment Protection*), **ou**
- use o **Protection Bypass for Automation**: gere o segredo e acrescente
  `?x-vercel-protection-bypass=<segredo>` às URLs dos webhooks. O script não monta isso (ele usa
  `ALERTAS_BASE_URL` + caminho), então nesse caso registre o `setWebhook` do Telegram e a URL do
  Discord à mão.

**Depois do smoke**, aponte os webhooks de volta pro domínio de produção: rode o script **sem**
`ALERTAS_BASE_URL` (padrão `https://shopfloor.enterplak.com.br`) e troque a *Interactions Endpoint
URL* do Discord para `https://shopfloor.enterplak.com.br/api/alertas/discord`. Religue a proteção
do preview, se tiver desligado.

## 5. Crontab (avaliação a cada 5 minutos)

O segredo **não** vai na linha do crontab **nem no argv do `curl`** (`-H "Authorization: Bearer
$(cat ...)"` expande o segredo na linha de comando, e qualquer usuário da máquina vê com `ps`).
Ele fica num **arquivo de cabeçalho** só do dono, com permissão **600**, que o `curl` lê com
`-H @arquivo`:

```bash
umask 077
printf 'Authorization: Bearer %s\n' "$ALERTAS_CRON_SECRET" > ~/.alertas-cron-header
chmod 600 ~/.alertas-cron-header
crontab -e
```

Linha a acrescentar (pronta):

```
# Alertas do ShopFloor. O cron da Lightsail roda em UTC: 9-21 UTC = 06:00–18:55 BRT, seg–sáb —
# só no período em que o RDS fica ligado (plano de economia). Chama o app direto na própria
# máquina (127.0.0.1:3000), sem passar por DNS/nginx/TLS.
*/5 9-21 * * 1-6 curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar >> $HOME/alertas.log 2>&1
```

Confira o fuso antes (`date` e `timedatectl | grep 'Time zone'`): se a máquina **não** estiver em
UTC, ajuste as horas. Fora desse horário (ou se o RDS estiver desligado por outro motivo) a rota
responde **503** e o log registra — nada mais acontece. Isso é esperado, não é um alarme.

Se já existia um `~/.alertas-cron-secret` de uma versão anterior deste guia, apague-o
(`shred -u ~/.alertas-cron-secret`) depois de criar o arquivo de cabeçalho.

## 6. Migrações

A `0113` cria as tabelas/funções dos alertas; a `0114` cria o índice de `sf_registros` usado pelas
janelas de avaliação. São aplicadas separadamente, com métodos diferentes por ambiente:

### Dev (Supabase cloud)

**Se o Dev já tem uma 0113 antiga** (anterior à fila de envio — `alerta_envios` sem a coluna
`reservado_em`), derrube tudo dos alertas antes de reaplicar: a 0113 usa `create table if not
exists` e manteria as tabelas velhas. Confira:

```sql
select exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = 'alerta_envios')      as tem_0113,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'alerta_envios'
                  and column_name = 'reservado_em')                                  as tem_fila;
```

`tem_0113 = true` e `tem_fila = false` → rode (só no **Dev**: apaga regras, ocorrências, envios e
vínculos dos alertas):

```sql
-- 1) funções alerta_* (qualquer assinatura, inclusive as de versões antigas)
do $func$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'alerta\_%'
  loop
    execute 'drop function ' || f.assinatura;
  end loop;
end
$func$;

-- 2) tabelas, das que dependem para as de que se depende
drop table if exists public.alerta_envios;
drop table if exists public.alerta_ocorrencias;
drop table if exists public.alerta_regras;
drop table if exists public.alerta_codigos;
drop table if exists public.alerta_tentativas;
drop table if exists public.alerta_contas;
```

Depois, as duas migrações pelo **SQL Editor** do Supabase, colando o conteúdo do arquivo:

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

### Depois da 0114 (Dev e Prod): o índice ficou válido?

Um `create index concurrently` que falha no meio deixa o índice criado mas **inválido** (o
planejador ignora). Confira:

```sql
select indisvalid from pg_index where indexrelid = 'sf_registros_posto_data_hora'::regclass;
```

Tem que dar `true`. Se der `false`: `drop index concurrently sf_registros_posto_data_hora;` e rode
a 0114 de novo.

### Depois de pôr as variáveis

`pm2 restart shopfloor --update-env` (sem o `--update-env` o processo continua com o ambiente
antigo e os canais aparecem como "não configurado").

## 6b. Migração 0115 — tipos de regra, destinatários do ShopFloor e filtro de PMO

A `0115_alertas_tipos.sql` vai **por cima** da 0113/0114 (a 0113 não muda). Ela:

- dá um **tipo** a cada regra (`aprovacao`, `tempo`, `defeito`) — as regras que já existem viram
  `aprovacao`, sem mudar nada no comportamento delas;
- cria o **filtro de PMO** (`pmos`, vazio = todas);
- passa a mandar alerta **só para usuário ativo com `shopfloor.administrar`** no perfil dele (na
  lista da tela, na fila, na entrega e no botão Resolvido).

É idempotente: rodar duas vezes não quebra.

**Rollback do app**: antes de voltar o app para uma versão anterior aos tipos de regra, desative as
regras de tipo `tempo` e `defeito`. O app velho só sabe montar e editar mensagem de regra
`aprovacao` — os envios dessas regras (alerta, lembrete, normalizou) falhariam depois de 3
tentativas, e a tela de edição do app velho não abriria o formulário delas.

### Antes de aplicar (Prod): quem vai parar de receber?

Destinatários de regras ativas que **não** administram o ShopFloor deixam de receber assim que a 0115
entra. Confira antes e, se for o caso, ajuste o perfil da pessoa:

```sql
select r.nome as regra, coalesce(nullif(btrim(u.nome), ''), u.email) as destinatario
  from alerta_regras r
  cross join unnest(r.destinatarios) as d(id)
  join usuarios u on u.id = d.id
 where r.excluida_em is null and u.ativo
   and not exists (select 1 from perfil_permissao pp
                    where pp.perfil_id = u.perfil_id
                      and pp.modulo = 'shopfloor' and pp.permissao = 'administrar');
```

### Ordem: banco primeiro, app logo depois

O app novo chama a `alerta_previa` nova (8 parâmetros) e lê as colunas novas. O app velho, com a 0115
aplicada, continua funcionando — **só a prévia do formulário** falha até o deploy do app novo. Então:
aplique a 0115 e suba o app em seguida.

### Dev e demo (SQL Editor do Supabase)

Cole `supabase/migrations/0115_alertas_tipos.sql` inteiro e rode (não tem `concurrently`; roda
dentro da transação do editor sem ajuste nenhum).

### Prod (RDS, via `psql` na instância Lightsail)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W \
  "host=shopfloor-prod-db... user=postgres sslmode=require" \
  -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0115_alertas_tipos.sql

cd ~/supabase/docker && docker compose restart rest   # recarrega o schema do PostgREST
```

### Depois da 0115 (Dev, demo e Prod): conferir

```sql
-- 1) todas as regras antigas viraram 'aprovacao'
select tipo, count(*) from alerta_regras group by tipo;

-- 2) índice novo no lugar do antigo: tem que listar alerta_ocorrencias_viva_defeito e NÃO alerta_ocorrencias_viva
select indexname from pg_indexes where tablename = 'alerta_ocorrencias' order by indexname;

-- 3) uma assinatura só de cada função que mudou (tem que dar 1, 1, 1)
select proname, count(*) from pg_proc
 where proname in ('alerta_previa', 'alerta_taxas', 'alerta_listar_ocorrencias')
 group by proname;

-- 4) quem a tela oferece como destinatário (rode logado como gestor, ou troque por usuario_tem_permissao)
select u.nome from usuarios u
 where u.ativo and usuario_tem_permissao(u.id, 'shopfloor', 'administrar')
 order by 1;
```

Depois: `pm2 restart shopfloor --update-env` (Prod) ou redeploy do Preview/`next dev`, e abra
**Configurações › Ajustes ShopFloor › Alertas** → **Nova regra** tem que mostrar os 3 cartões.

## 7. Conferir

- `curl -i -X POST https://shopfloor.enterplak.com.br/api/alertas/avaliar` → **401** (sem segredo).
- Com o segredo → `{"avaliadas":N,"enfileirados":N,"enviados":N,"falhas":N,"ocupado":false}`
  (`enfileirados` = mensagens que esta avaliação pôs na fila; `enviados`/`falhas` = o que a
  entrega desta rodada conseguiu). Na própria Lightsail:
  `curl -fsS -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar`.
- `https://api.telegram.org/bot<token>/getWebhookInfo` → a URL e `has_custom_certificate:false`
  (rode no seu terminal, não em log compartilhado).
- Tela **Meu perfil** → Vincular → o bot responde.

## 8. Lançamento escondido em produção

A feature vai pro ar (código em produção, cron rodando, webhooks funcionando) antes de ficar
visível para todo mundo. Quem controla isso é a variável de ambiente **`ALERTAS_LIBERADO_PARA`**:

- Lista de e-mails separados por vírgula (ex.: `fulana@enterplak.com.br,ciclano@enterplak.com.br`).
  Comparação sem diferenciar maiúsculas/minúsculas e com `trim` (espaços em volta não importam).
- `*` libera todo mundo. **Para liberar de vez pra empresa inteira, troque o valor por `*`** e
  reinicie o processo — não precisa mexer em código. Em Preview/Dev, use `*` ou o seu e-mail.
- **Vazia ou ausente = ninguém.** Esquecer a variável num deploy não expõe as telas.

O que a variável esconde:

- O item **Alertas** do menu (Configurações › Ajustes ShopFloor) e o link **Meu perfil**
  (cabeçalho e rodapé do menu — hoje Meu perfil só tem o cartão de Alertas).
- As páginas `/perfil` e `/configuracoes/sf-alertas`: fora da lista, mostram a tela padrão de
  "sem permissão", mesmo digitando a URL direto.
- As *server actions* de regras/ocorrências e de vínculo/teste: fora da lista, voltam
  `{ ok: false, erro: 'Recurso indisponível.' }` mesmo chamadas fora do menu.

O que a variável **não** esconde (de propósito): as rotas `/api/alertas/avaliar`,
`/api/alertas/telegram` e `/api/alertas/discord` continuam no ar pra qualquer e-mail — são o cron e
os webhooks dos bots, e sem elas rodando nada é avaliado nem entregue, mesmo pra quem já está
liberado. A segurança delas é o próprio segredo/assinatura de cada uma (ver seção 9 do roteiro de
smoke), não esta variável.

Depois de mudar `ALERTAS_LIBERADO_PARA`: `pm2 restart shopfloor --update-env` (Prod) ou reinicie o
`next dev`/redeploy do Preview — como qualquer outra variável de ambiente.
