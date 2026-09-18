# Smoke — Alertas de taxa de aprovação (Telegram/Discord)

Guia pra rodar na mão, passo a passo. Idealmente num ambiente de teste (Dev ou Preview da
Vercel) — só depois de validado tudo isso vai pro Prod (AWS).

## 0. Criar os bots (só na primeira vez)

Siga `tools/alertas/README.md` do começo ao fim:

1. **Telegram:** fale com o **@BotFather** no Telegram → `/newbot` → guarde o **token**
   (`TELEGRAM_BOT_TOKEN`) e o usuário do bot sem o `@` (`TELEGRAM_BOT_USERNAME`). Invente um
   segredo grande pro `TELEGRAM_WEBHOOK_SECRET` (ex.: `openssl rand -hex 24`).
2. **Discord:** **Discord Developer Portal** → **New Application** → copie **Application ID**
   (`DISCORD_APP_ID`) e **Public Key** (`DISCORD_PUBLIC_KEY`) em *General Information*; em *Bot*,
   **Reset Token** e guarde (`DISCORD_BOT_TOKEN`); em *OAuth2 → URL Generator*, marque `bot` +
   `applications.commands` e abra a URL gerada pra **convidar o bot pro servidor da Enterplak**;
   pegue o ID do servidor (modo desenvolvedor ligado → botão direito no servidor → Copiar ID) em
   `DISCORD_GUILD_ID`.
3. Coloque as 8 variáveis (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`,
   `TELEGRAM_WEBHOOK_SECRET`, `DISCORD_BOT_TOKEN`, `DISCORD_APP_ID`, `DISCORD_PUBLIC_KEY`,
   `DISCORD_GUILD_ID`, `ALERTAS_CRON_SECRET`) no `.env.local` (pra testar local) ou nas
   Environment Variables do **Preview** da Vercel (pra testar num domínio público, que o Telegram e
   o Discord conseguem alcançar — local com `localhost` não funciona para os webhooks).
4. Rode o script de configuração. Ele **não** carrega `.env` sozinho: passe o arquivo com
   `--env-file` (Node ≥ 20.6):
   ```bash
   node --env-file=.env.local tools/alertas/configurar-bots.mjs
   ```
   Num Preview, use `ALERTAS_BASE_URL=https://seu-preview.vercel.app node --env-file=.env.local tools/alertas/configurar-bots.mjs`.
   **Antes**, desligue a **Deployment Protection** do preview na Vercel (ou use o bypass token —
   ver README §4): com ela ligada, os webhooks do Telegram e do Discord batem na tela de login da
   Vercel e nunca chegam no app.
   Confira que a saída diz "webhook apontado para ..." e "comando /vincular registrado" — sem
   nenhum token na tela.
5. No Discord Developer Portal, em *General Information → Interactions Endpoint URL*, cole a URL
   do ambiente testado + `/api/alertas/discord` (ex.: `https://seu-preview.vercel.app/api/alertas/discord`)
   e salve — o Discord manda um PING assinado na hora; se aceitar, o campo fica salvo sem erro.
6. **Depois do smoke no preview:** aponte os webhooks pro domínio de produção (rode o script sem
   `ALERTAS_BASE_URL` e troque a *Interactions Endpoint URL* do Discord para
   `https://shopfloor.enterplak.com.br/api/alertas/discord`) e religue a proteção do preview.

## 1. Aplicar as migrações no banco do ambiente testado

- **Dev (SQL Editor do Supabase):**
  - se o Dev já tem uma **0113 antiga** (anterior à fila de envio: `alerta_envios` sem a coluna
    `reservado_em`), rode antes o SQL de drop do README §6 (funções `alerta_*` e depois as tabelas
    `alerta_envios` → `alerta_ocorrencias` → `alerta_regras` → `alerta_codigos` →
    `alerta_tentativas` → `alerta_contas`) — senão o `create table if not exists` mantém as
    tabelas velhas;
  - cole e rode `supabase/migrations/0113_alertas.sql` inteiro;
  - abra `supabase/migrations/0114_sf_registros_posto_data_idx.sql`, **remova a palavra
    `concurrently`** da linha do `create index` e rode.
- **Prod (RDS via `psql` na instância Lightsail)** — só quando for promover pra valer:
  ```bash
  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=... user=postgres sslmode=require" \
    -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0113_alertas.sql

  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=... user=postgres sslmode=require" \
    -v ON_ERROR_STOP=1 -f supabase/migrations/0114_sf_registros_posto_data_idx.sql   # SEM -1
  ```
  (`PGPASSFILE=/dev/null` porque o `.pgpass` da Lightsail está com a senha antiga; `-W` força pedir
  a senha certa na hora.)
- [ ] Depois da 0114, confira que o índice ficou válido (tem que dar `true`):
  `select indisvalid from pg_index where indexrelid = 'sf_registros_posto_data_hora'::regclass;`
- Depois de qualquer uma: `cd ~/supabase/docker && docker compose restart rest` (a 0113 já roda
  `notify pgrst, 'reload schema';` na última linha, mas o restart garante).
- Reinicie o app com as variáveis novas: `pm2 restart shopfloor --update-env` (Prod) ou reinicie o
  `next dev`/redeploy do Preview.

## 2. Vínculo (tela Meu perfil)

- [ ] Entrar no sistema → clicar no **nome no cabeçalho** (ou no bloco do nome no rodapé do menu)
      → abre **Meu perfil** com o cartão Alertas. O vínculo é **por código**, não por nome nem
      e-mail: quem gera o código é o dono da sessão.
- [ ] Canal sem token configurado no ambiente aparece como **"Não configurado neste ambiente"** e
      o botão Vincular fica desabilitado.
- [ ] **Telegram → Vincular**: aparece `ALERTA-XXXX` com contador de 15 min; abra o bot no
      Telegram (link `t.me/<usuário>`) e mande o código → o bot responde
      "✅ Conta vinculada ao ShopFloor (seu nome)" e a tela troca sozinha para
      **"Vinculado em dd/mm"** (ela consulta o vínculo a cada 3 s).
- [ ] **Discord → Vincular**: no servidor da Enterplak, `/vincular codigo:ALERTA-XXXX` → resposta
      efêmera de confirmação; a tela atualiza.
- [ ] **Enviar teste** nos dois canais: chega "🔔 Teste do ShopFloor — seu nome, os alertas de taxa
      de aprovação vão chegar aqui." na DM.
- [ ] **Código expirado** (esperar 15 min) ou **código já usado** (mandar de novo um código que já
      vinculou) → o bot responde **"Código inválido ou já usado. Gere um novo em Meu perfil."** (o
      banco não distingue expirado de reusado de propósito — não dá pista pra quem estiver
      tentando adivinhar).
- [ ] **Limite de tentativas**: mande 5 códigos errados seguidos pro mesmo bot (ex.:
      `ALERTA-0000` repetido) → na 5ª falha (ou na próxima tentativa depois dela) o bot responde
      **"Muitas tentativas. Aguarde 15 minutos e gere um código novo no ShopFloor."**, mesmo que o
      próximo código enviado esteja certo. Esperar os 15 min (ou usar outra conta de teste) pra
      seguir.

## 3. Regra e alerta

- [ ] **Configurações › Ajustes ShopFloor › Alertas** → **Nova regra**: escolha um posto com
      bipes de hoje, **taxa mínima 99,99%** (pra garantir o disparo), janela **últimos 1440
      minutos**, mínimo de bipes **1**, lembrete **1** min, os dois canais, você como
      destinatário.
- [ ] **Ver prévia** mostra a taxa atual do posto antes de salvar.
- [ ] Marque como destinatário alguém sem Telegram vinculado → aparece o aviso
      "Nome sem Telegram" (o texto muda pro canal que faltar).
- [ ] **Avaliar agora** → alerta chega nos dois canais com o botão **✅ Resolvido**; a aba
      **Ocorrências** mostra a linha **Aberta** com **"2 ok"** (uma entrega por canal).

## 4. Lembrete

- [ ] Esperar 1 minuto → **Avaliar agora** → chega o **⏰ Lembrete — continua abaixo há N min**
      (mesmo corpo do alerta, com o cabeçalho de tempo).
- [ ] **Avaliar agora** de novo na mesma hora → **não** chega lembrete repetido (só reenvia depois
      de outro ciclo do intervalo configurado).

## 5. Resolvido

- [ ] Apertar **✅ Resolvido** no Telegram → o botão sai da mensagem (ela ganha a linha
      "✅ posto: resolvido por Nome às HH:MM"), e a mensagem do **Discord** perde o botão; o aviso
      "resolvido por" só chega aos **outros** destinatários (quem apertou não recebe aviso de si
      mesmo — pra ver o aviso, tenha um segundo destinatário vinculado).
- [ ] A ocorrência fica **Resolvida** na tela; **Avaliar agora** não manda mais lembrete pra ela.
- [ ] Apertar o botão de uma ocorrência já resolvida (se ainda estiver visível) → responde
      **"Já resolvido por Nome."**
- [ ] Repetir pelo **Discord** (botão da DM) numa nova ocorrência: a mensagem é atualizada sem
      botão, mesmo texto.
- [ ] **Marcar resolvida** pela tela numa ocorrência aberta → os outros destinatários (menos quem
      marcou) recebem o aviso e os botões saem das mensagens de todos.

## 6. Normalizou

- [ ] Editar a regra para **taxa mínima 1%** → **Avaliar agora** → chega
      **🟢 posto normalizou: X% (ficou N min abaixo)**; a ocorrência fica **Normalizada** e os
      botões antigos desaparecem das mensagens já enviadas.
- [ ] Voltar a meta para 99,99% → **Avaliar agora** → abre uma ocorrência **nova** (não reabre a
      antiga).

## 7. Regra desligada / posto removido

- [ ] Com ocorrência aberta, desligar o interruptor **Ativa** → **Avaliar agora** → a ocorrência
      vira **Normalizada** e **nada** é enviado (sem 🟢, sem aviso — silencioso).
- [ ] Tirar o posto da regra → mesmo comportamento.
- [ ] **Excluir** uma regra que tem ocorrência (confirmação: "A regra sai da lista e para de
      alertar; o histórico de ocorrências continua disponível.") → some da aba **Regras**; na aba
      **Ocorrências** as linhas dela continuam, com o nome **"Nome da regra (excluída)"**;
      **Avaliar agora** não alerta mais por ela e a ocorrência viva vira **Normalizada** sem envio
      (os botões saem). Isso confirma a **exclusão lógica**: nada do histórico some.

## 8. Fila de envio (o alerta nunca se perde)

- [ ] Com um destinatário que **bloqueou DM** do bot (Discord: desligar "Permitir mensagens
      diretas de membros do servidor"), **Avaliar agora** → a aba Ocorrências mostra a falha
      (contador "N falha"); nas rodadas seguintes a linha é tentada de novo, até **3 tentativas**.
      (Canal **sem token** no ambiente NÃO serve pra este teste: a linha daquele canal nem é
      reservada — fica pendente e vence em 24 h sem contar como falha.)
- [ ] **Usuário desativado:** desative um destinatário vinculado (Usuários) → **Avaliar agora**
      numa ocorrência nova → ele não recebe nada; ao abrir a regra, aparece
      "1 destinatário(s) inativo(s) removido(s) da regra — salve para confirmar".
- [ ] Clicar **Avaliar agora** duas vezes seguidas (ou junto com o crontab, se já estiver rodando)
      → cada destinatário recebe a mensagem **uma vez só** (a reserva da fila é atômica — duas
      chamadas não pegam a mesma linha pendente).
- [ ] **Se o servidor cair no meio de um envio**: a linha fica "reservada" por até 15 minutos; se o
      processo não confirmar a entrega nesse tempo, ela volta a ficar disponível e é reenviada. Ou
      seja: o alerta **nunca se perde**, mas em caso de queda pode **sair duplicado** — é a
      garantia de "pelo menos uma vez", não "exatamente uma vez". Não há como testar isso sem
      derrubar o processo de propósito; fica documentado como comportamento esperado.

## 9. Cron e segurança

- [ ] `curl -i -X POST .../api/alertas/avaliar` (sem cabeçalho) → **401**.
- [ ] Com `-H "Authorization: Bearer <ALERTAS_CRON_SECRET>"` → **200** com
      `{"avaliadas":N,"enfileirados":N,"enviados":N,"falhas":N,"ocupado":false}`.
- [ ] `curl -i -X POST .../api/alertas/telegram` (sem o cabeçalho do Telegram) → **401**.
- [ ] `curl -i -X POST .../api/alertas/discord -d '{}'` (sem assinatura Ed25519) → **401**.
- [ ] Configurar o crontab (só em Prod, na Lightsail) exatamente como o README §5 manda — **o
      segredo nunca vai na linha do `crontab -e` nem no argv do `curl`**, só num arquivo de
      cabeçalho com permissão 600:
      ```bash
      umask 077
      printf 'Authorization: Bearer %s\n' "$ALERTAS_CRON_SECRET" > ~/.alertas-cron-header
      chmod 600 ~/.alertas-cron-header
      crontab -e
      ```
      Linha (cron da Lightsail em UTC: 9-21 UTC = 06:00–18:55 BRT, seg–sáb, só com o RDS ligado):
      `*/5 9-21 * * 1-6 curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar >> $HOME/alertas.log 2>&1`
- [ ] Esperar o crontab rodar (até 5 min) e conferir `~/alertas.log` — deve ter uma linha JSON por
      execução.
- [ ] **Com o RDS desligado** (fora do horário do cron, ou desligado por outro motivo), a rota responde **503** e o log
      registra isso; nada mais acontece. Isso é esperado, não precisa virar chamado.
- [ ] **Permissão:** logar com um usuário **sem** `shopfloor.administrar` → não vê o item
      **Alertas** no menu de Configurações, e abrir `/configuracoes/sf-alertas` direto pela URL
      mostra "sem permissão"; mas **Meu perfil** (vincular/desvincular/enviar teste) funciona
      normal pra qualquer um.

## 10. Desvincular

- [ ] **Desvincular** o Telegram em Meu perfil (com confirmação) → gerar uma ocorrência nova
      (baixe a meta de novo) → **Avaliar agora** → o alerta chega só no Discord.

## 11. Lançamento escondido em produção

A feature entra no ar (código + cron + webhooks) antes de ficar visível pra empresa inteira. Quem
esconde/mostra é a variável de servidor `ALERTAS_LIBERADO_PARA` (lista de e-mails, `*` = todos,
**vazia/ausente = todos** — ver `tools/alertas/README.md` §8 para o passo a passo completo).

- [ ] Com `ALERTAS_LIBERADO_PARA=outro@enterplak.com.br` (sem o seu e-mail de teste): logado com a
      sua conta, o item **Alertas** some do menu de Configurações e o link **Meu perfil** some do
      cabeçalho e do rodapé do menu (o nome continua aparecendo, só sem virar link).
- [ ] Abrir `/perfil` e `/configuracoes/sf-alertas` **direto pela URL** → tela de **sem
      permissão** nos dois casos, mesmo sendo gestor com `shopfloor.administrar`.
- [ ] Chamar as *server actions* fora do menu (ex.: pelo DevTools, se der, ou confiar na leitura de
      código) → retornam `{ ok: false, erro: 'Recurso indisponível.' }`.
- [ ] As rotas `/api/alertas/avaliar`, `/api/alertas/telegram` e `/api/alertas/discord` continuam
      respondendo normalmente (o cron e os webhooks não podem parar por causa do lançamento
      escondido).
- [ ] Colocar o seu e-mail em `ALERTAS_LIBERADO_PARA` (ou usar `*`) → reiniciar → Alertas volta a
      aparecer no menu e as telas abrem normal.
- [ ] **Não quebrou nada:** quiosque, menu retrátil e o grupo Setup continuam funcionando iguais
      com a variável ligada ou desligada.
- [ ] **Liberação final:** remover `ALERTAS_LIBERADO_PARA` do ambiente (ou deixar vazia) e
      reiniciar → todo mundo passa a ver Alertas, sem precisar mexer em código.
