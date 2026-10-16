# Deploy do Fim de EMB — migrações 0149, 0150 e 0151

Produção está na **0148 + 0152**. Este deploy leva as migrações **0149** (módulo da regra de alerta),
**0150** (regra "Fim de EMB" do Recebimento) e **0151** (canal de e-mail), o app da main com a tela
**Ajustes Recebimento › Alertas**, e as variáveis de SMTP do app (o canal de e-mail).

⚠️ Os Alertas do ShopFloor **já estão no ar** (Discord + Telegram + o cron de 5 em 5 minutos). As três
migrações **substituem funções e policies que estão rodando**. Por isso o banco vai numa transação só
(passo 6) e o rollback existe (fim deste arquivo).

O objetivo é deixar o Fim de EMB **visível só para você** em produção. Quem decide quem vê é a variável
`ALERTAS_LIBERADO_PARA` do app — e ela vale para as DUAS telas de Alertas (ShopFloor e Recebimento) e para
o Meu perfil. Por isso o **passo 1 é ler o valor atual dela**, antes de tocar em qualquer coisa.

Tudo roda **na instância Lightsail**, no terminal, **um comando por vez, colado como está**. Nenhum comando
tem coisa para trocar. A senha do banco é **digitada** no prompt `Password:` do `-W` (nunca em comando,
nunca no chat). Se o terminal cair no meio, volte ao **passo 3** (a variável `HOST` some junto com o terminal).

Os arquivos de apoio ficam no repositório em `docs/operacao/fim-de-emb/` (tem que estar na **main** antes
de começar — os comandos leem de `origin/main`):

| arquivo | o que faz | grava? |
|---|---|---|
| `01-conferir-antes.sql` | confere funções, policies, checks e as linhas que os checks novos vão validar | **não** (sessão somente leitura) |
| `02-copiar-antes.sql` | guarda as definições que as migrações substituem em `public.alerta_bkp_0149_0151_objetos` | sim (tabela nova, fechada para o app) |
| `03-rollback-0149-0151.sql` | desfaz as três migrações — **só** se algo der errado | sim |
| `04-smtp-no-app.sh` | copia o SMTP do GoTrue para o `.env.production` do app, sem imprimir valor | sim (`.env.production`) |

---

## Passo 1 — ler quem enxerga os Alertas hoje (ANTES de tudo)

```bash
cd ~/ShopFloor && ls -1 .env* && grep -HnE '^[[:space:]]*(export[[:space:]]+)?ALERTAS_LIBERADO_PARA[[:space:]]*=' .env* ; echo '--- no processo do app (normalmente nada):' ; tr '\0' '\n' < /proc/$(pm2 pid shopfloor)/environ | grep '^ALERTAS_LIBERADO_PARA=' || true
```

Imprime **só** a linha dessa variável (é uma lista de e-mails, não é segredo) em cada arquivo `.env*`, e se
ela também foi posta direto no processo do pm2 (o que manda, se existir). O arquivo que o app usa é o
`.env.production`; um `.env.local` ou `.env.production.local`, se aparecer na lista, **ganha** dele.

**Decida pelo valor que aparecer:**

- **Só o seu e-mail de login** (exatamente um e-mail, o seu) → nada a mudar. Siga para o passo 2.
- **`*`**, **vários e-mails**, **vazio** ou **a variável não aparece** → **PARE aqui e mande o valor**.
  Com `*` ou vários e-mails, a tela nova de Alertas do Recebimento passaria a aparecer para todos os que
  estão na lista e administram o Recebimento (o bloco 7 do passo 4 mostra quem são), e o link Meu perfil
  passaria a aparecer também para quem administra só o Recebimento. Vazio ou ausente = hoje ninguém vê
  nem os Alertas do ShopFloor. Em qualquer desses casos a decisão (mudar a lista ou pôr uma trava própria
  do Recebimento no código) é tomada antes do deploy, não durante.

## Passo 2 — anotar o commit que está no ar e baixar a main

Guarda o commit atual (é para onde o app volta se algo der errado) e busca a main **sem** mexer no código
do disco (o `git pull` aqui faria o `deploy.sh` pular o build):

```bash
cd ~/ShopFloor && git rev-parse HEAD > ~/antes-fimemb.txt && cat ~/antes-fimemb.txt && git fetch origin main
```

**Olhar:** aparece um hash (o commit em produção hoje) e o fetch termina sem erro.

## Passo 3 — extrair os arquivos e pegar o host do banco

As três migrações vão **num arquivo só**, na ordem 0149 → 0150 → 0151, para entrarem numa transação só:

```bash
cd ~/ShopFloor && git show origin/main:supabase/migrations/0149_alertas_modulo.sql > /tmp/fimemb-migracoes.sql && git show origin/main:supabase/migrations/0150_alertas_fim_de_emb.sql >> /tmp/fimemb-migracoes.sql && git show origin/main:supabase/migrations/0151_alertas_canal_email.sql >> /tmp/fimemb-migracoes.sql && git show origin/main:docs/operacao/fim-de-emb/01-conferir-antes.sql > /tmp/fimemb-01.sql && git show origin/main:docs/operacao/fim-de-emb/02-copiar-antes.sql > /tmp/fimemb-02.sql && git show origin/main:docs/operacao/fim-de-emb/03-rollback-0149-0151.sql > /tmp/fimemb-03.sql && git show origin/main:docs/operacao/fim-de-emb/04-smtp-no-app.sh > /tmp/fimemb-04.sh && wc -l /tmp/fimemb-*
```

```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && echo "HOST ok"
```

**Olhar:** os cinco arquivos com número de linhas (nenhum com 0; o das migrações tem por volta de 2.900
linhas) e `HOST ok`.

> As três migrações **não têm** `begin`/`commit` próprios nem `create index concurrently` (conferido
> separando o que está fora dos corpos `$func$`: só `alter`, `create`, `drop`, `revoke`, `grant`,
> `comment`, `do` e `notify`). Por isso as três cabem num `psql -1`.

## Passo 4 — conferir antes (somente leitura)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/fimemb-01.sql
```

**Olhar** (cada bloco começa com `== N.` explicando o número). **PARE e mande a saída** se:

- **Bloco 1:** algum `existe` ou `igual_ao_esperado` = `f`. (As 5 funções vivas têm de ser exatamente as
  das migrações 0141/0137/0123/0115/0137 — é esse corpo que o rollback devolve.) Nas versões: 1 em cada
  uma das cinco primeiras, 0 em `alerta_regras_modulo_fixo`, `rec_embs_fechadas` e `rec_emb_divergencias`.
- **Bloco 2:** algum `igual_ao_esperado` = `f` (as 6 policies de alertas têm de ser as da 0113).
- **Bloco 3:** algum `igual_ao_esperado` = `f` (os 6 checks que mudam têm de estar com o nome e a definição
  que o rollback recria).
- **Bloco 4:** qualquer número diferente de **0**, ou alguma linha na lista "As linhas que violariam".
- **Bloco 5:** qualquer `t`, **menos** `ja_existe_copia_bkp` (esse é `t` se você já rodou o passo 5 antes).
- **Bloco 6:** algum `f`.

**Anote** do bloco 4b: `total_regras`, `total_envios` e `envios_pendentes_agora` (para comparar depois).
O bloco 7 lista quem administra o Recebimento (são os únicos que podem ser responsáveis numa regra de
Fim de EMB).

## Passo 5 — copiar as definições que as migrações substituem

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/fimemb-02.sql
```

**Olhar:** na primeira vez, `copiados_agora` = `check 24 · funcao 5 · policy 6` e o total igual. Rodar de
novo é seguro (copia 0 e não sobrescreve a primeira cópia). Se der `ERROR`, nada foi gravado: **não siga**
para o passo 6. (As migrações não reescrevem nenhuma linha de dado — só acrescentam a coluna `modulo`
com default `'shopfloor'` —, por isso a cópia é de definições, não de linhas.)

## Passo 6 — aplicar 0149 + 0150 + 0151 numa transação só ⚠️ (o passo que só se desfaz com o rollback)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/fimemb-migracoes.sql
```

**Olhar:** uma lista de `ALTER TABLE` (25), `CREATE FUNCTION` (13), `REVOKE` (14), `GRANT` (10),
`DROP POLICY`/`CREATE POLICY` (4 cada), `DROP FUNCTION` (3), `DO` (3), `COMMENT` (3), `CREATE TABLE`,
`DROP TRIGGER`, `CREATE TRIGGER` e `NOTIFY` (3), mais 9 avisos `NOTICE: ... does not exist, skipping`
(normais: são os `drop ... if exists` de coisas que ainda não existiam). Termina **sem** `ERROR`.

- Se aparecer `ERROR`, a transação **inteira** voltou (`-1`): **nenhuma** das três ficou aplicada (provado no
  ensaio com uma falha no meio da 0150 e outra na 0151). Pare e mande o erro.
- `ERROR: canceling statement due to lock timeout` = o cron (ou alguém na tela) estava usando as tabelas
  de alerta naquele instante. Nada mudou; espere um minuto e rode o mesmo comando de novo.
- ⚠️ **Não rode este passo duas vezes depois de ter dado certo.** A 0149 **não** reaplica por cima da 0151
  (falha limpa com `-1`, mas falha), e reaplicar uma migração mais velha por cima da mais nova desfaz a
  mais nova em silêncio. Cada uma entra **uma vez**.

> **Este é o passo irreversível sem o `03-rollback-0149-0151.sql`.** Ele troca 5 funções que rodam a cada
> 5 minutos, 3 policies e 7 checks, e cria a coluna `modulo`, a tabela `alerta_emb_avisada` e duas funções
> do Recebimento. O app velho continua funcionando com o banco novo (a 0149 foi feita para isso), então
> entre este passo e o deploy (passo 9) os alertas do ShopFloor seguem saindo normalmente.

Conferir na hora (tem que dar `t | t | t | f | t | t | t | 0`):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'alerta_regras' and column_name = 'modulo') as modulo_regras, exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'alerta_envios' and column_name = 'modulo') as modulo_envios, to_regprocedure('public.alerta_destinatarios(text)') is not null as destinatarios_novo, to_regprocedure('public.alerta_destinatarios()') is not null as destinatarios_velho, to_regclass('public.alerta_emb_avisada') is not null as tabela_emb, to_regprocedure('public.rec_embs_fechadas(timestamptz)') is not null as rec_embs_fechadas, (select count(*) = 1 from pg_constraint where conname = 'alerta_envios_email_so_pessoa') as check_email, (select count(*) from public.alerta_regras where modulo <> 'shopfloor') as regras_fora_do_shopfloor;"
```

## Passo 7 — reiniciar o PostgREST (obrigatório, depois da migração)

```bash
cd ~/supabase/docker && docker compose restart rest
```

**Olhar:** `Container ... rest ... Started`.

## Passo 8 — SMTP do app (canal de e-mail)

O app precisa de `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` e `SMTP_REMETENTE` no `.env.production`
(o `SMTP_SEGURO` é opcional e não é mexido). O script copia as MESMAS credenciais que o GoTrue já usa para
o "esqueci a senha" — lendo do container `auth` em execução (o valor efetivo) ou, se ele não responder, do
`~/supabase/docker/.env` — e monta o remetente como `SMTP_SENDER_NAME <SMTP_ADMIN_EMAIL>`. **Não imprime
nenhum valor.** Grava cada valor entre aspas simples com `$` escapado (o Next corta um valor sem aspas no
`#` e expande `$NOME` até dentro de aspas simples), tira as linhas antigas dessas variáveis antes de
escrever (rodar duas vezes deixa uma linha de cada) e guarda uma cópia do arquivo original em
`.env.production.antes-fim-de-emb`.

```bash
bash /tmp/fimemb-04.sh
```

**Olhar:** `origem das credenciais: container auth` (ou o caminho do `.env`), `gravado em ...` e as cinco
linhas `definida, N caracteres (igual à origem)`, terminando em `OK: ...`. Se aparecer `PARE: ...`, nada
foi gravado: mande a linha. Para conferir de novo a qualquer momento (só nomes e tamanhos):

```bash
bash /tmp/fimemb-04.sh conferir
```

(O app só lê o arquivo ao reiniciar — o passo 9 reinicia.)

## Passo 9 — deploy do app

O `git fetch` do passo 2 já foi feito; **não** rode `git pull` antes deste comando.

```bash
cd ~/ShopFloor && ./deploy/aws/deploy.sh
```

**Olhar:** termina com `==> deploy OK -> <commit da main>`.

Se aparecer **`Nada novo na main. Deploy não necessário.`**, alguém deu `git pull` antes e o script pulou
o build — o app velho continua no ar (e sem as variáveis de SMTP carregadas). Rode o build e o restart à mão:

```bash
cd ~/ShopFloor && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```

---

## Verificação em produção (depois do passo 9)

- [ ] **1. O cron e os alertas do ShopFloor continuam vivos.** A mesma chamada que o crontab faz (só
      responde entre 06:00 e 18:55, seg–sex, quando o RDS está ligado; fora disso dá 503, o que é normal):

```bash
curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar ; echo ; tail -n 3 ~/alertas.log
```

  **Olhar:** um JSON `{"avaliadas":N,"enfileirados":N,"enviados":N,"falhas":N,"ocupado":false}` sem erro
  (e as últimas linhas do log do cron sem erro depois do horário do deploy). `falhas` > 0 logo depois do
  deploy: mande o JSON.

- [ ] **2. A tela do ShopFloor:** **Configurações › Ajustes ShopFloor › Alertas** abre com as mesmas regras
      de antes e as ocorrências carregam (nenhuma regra antiga some: todas viraram módulo `shopfloor`).
- [ ] **3. A tela nova, para você:** **Configurações › Ajustes Recebimento** tem o item **Alertas**;
      `https://shopfloor.enterplak.com.br/configuracoes/rec-alertas` abre a lista (vazia) com **Nova regra**,
      e no formulário o canal **E-mail** não aparece como "não configurado" (se aparecer, o passo 8 não
      foi lido pelo app: confira com `bash /tmp/fimemb-04.sh conferir` e reinicie com
      `pm2 restart shopfloor --update-env`).
- [ ] **4. A tela nova, para mais ninguém:** entre com **outra conta** que administre o Recebimento (uma
      das pessoas do bloco 7 do passo 4, ou uma conta de teste com o perfil Recebimento), numa janela anônima:
      em **Ajustes Recebimento** **não** pode haver o item **Alertas**, e abrir
      `https://shopfloor.enterplak.com.br/configuracoes/rec-alertas` direto tem de mostrar
      "Você não tem permissão para configurar alertas.". (Sem outra conta à mão: a trava é só a variável
      lida no passo 1 — com ela contendo só o seu e-mail, nenhuma outra conta passa.)
- [ ] **5. Criar a regra de teste:** em **Ajustes Recebimento › Alertas › Nova regra › Fim de EMB**, nome
      **exatamente** `TESTE fim de EMB`, responsável **só você**, canal **E-mail** (e Telegram, se quiser os
      dois). Salve e clique **Avaliar agora**.
      **O que esperar:** normalmente **nada sai**, e isso é o certo. A regra só avisa EMB cuja **última
      finalização** é **depois** da criação da regra (o piso, para a primeira rodada não avisar todo o
      histórico) **e** dos **últimos 3 dias** (o teto). EMB que já estava fechada antes de você salvar a
      regra **não** avisa. O teste de verdade é a **primeira EMB real que fechar** depois de agora: quando o
      último item dela chegar ao Almoxarifado ou for Reprovado, no máximo 5 minutos depois (o cron) chega um
      e-mail com o assunto `📦 EMB… fechou — …`. EMB sem divergência também avisa ("fechou sem divergência").

  **Opcional — forçar o teste agora sem mexer em dado real:** dá para fazer a regra de teste "nascer" um dia
  antes, e ela passa a avisar as EMBs que fecharam nas últimas 24 h — só para você, porque só você é
  responsável dela. Primeiro veja quais EMBs seriam (somente leitura; **são as mensagens que você vai
  receber, uma por EMB**):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select emb, fechada_em from public.rec_embs_fechadas(now() - interval '1 day') order by fechada_em;" -c "select r.nome, array_length(r.destinatarios, 1) as responsaveis, r.canais, r.criado_em from public.alerta_regras r where r.modulo = 'recebimento' and r.tipo = 'emb' and r.nome = 'TESTE fim de EMB' and r.excluida_em is null;"
```

  Se a lista for razoável e a regra aparecer com `responsaveis = 1`, recue a regra (mexe **só** na regra de
  teste; tem que responder `regras_recuadas = 1`) e clique **Avaliar agora** de novo:

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "with u as (update public.alerta_regras set criado_em = now() - interval '1 day' where modulo = 'recebimento' and tipo = 'emb' and nome = 'TESTE fim de EMB' and excluida_em is null and array_length(destinatarios, 1) = 1 returning 1) select count(*) as regras_recuadas from u;"
```

  Cada EMB avisada ganha uma marca e não avisa de novo por esta regra. Depois do teste, exclua a regra de
  teste pela tela (ou deixe — ela só fala com você).

- [ ] **6. Fila sem sobra:** o e-mail saiu e a linha foi marcada como enviada (tem que dar `pendentes = 0`
      alguns minutos depois do teste):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select canal, tipo, modulo, count(*) filter (where ok) as enviadas, count(*) filter (where not ok and tentativas < 3 and criado_em >= now() - interval '24 hours') as pendentes, count(*) filter (where not ok and (erro is not null or tentativas >= 3)) as falhas, max(erro) as ultimo_erro from public.alerta_envios where criado_em >= now() - interval '1 day' group by 1, 2, 3 order by 1, 2, 3;"
```

Se tudo passou, as cópias podem ser apagadas **depois** (dias, não agora):
`PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "drop table if exists public.alerta_bkp_0149_0151_objetos;"`

---

## Se algo der errado

**Antes do passo 6:** nada mudou no que o app usa. O passo 5 só criou a tabela de cópia; pode ficar.

**Durante o passo 6 com `ERROR`:** a transação voltou inteira. Nada a desfazer.

**Só o SMTP (passo 8) deu problema:** o banco e o app podem ficar; volte o arquivo do app e reinicie:
`cp -p ~/ShopFloor/.env.production.antes-fim-de-emb ~/ShopFloor/.env.production && pm2 restart shopfloor --update-env`.

**Depois do passo 6** (alertas do ShopFloor parados, tela quebrada, erro no cron), **nesta ordem**:

**1. Primeiro o app volta** para o commit anotado no passo 2 (o app novo chama funções e colunas que o
rollback apaga; o app velho funciona com os dois bancos):

```bash
cd ~/ShopFloor && git reset --hard $(cat ~/antes-fimemb.txt) && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```

**Olhar:** o build termina e o `pm2` reinicia; o item **Alertas** some de Ajustes Recebimento. (O próximo
`deploy.sh` volta para a main normalmente: o `git pull` avança de novo.)

**2. Depois o banco** (precisa do `HOST` do passo 3 e de `/tmp/fimemb-03.sql`):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/fimemb-03.sql
```

**Olhar:** a linha `NOTICE: b) envios apagados: A | marcas de EMB copiadas: B | regras do Recebimento
apagadas: C | regras com e-mail tirado dos canais: D (destas, desativadas por ficarem sem canal: E)`, a
linha `NOTICE: i) conferência com a cópia do 02: 35 iguais, 0 diferentes, 0 faltando, 0 checks a mais`,
e `COMMIT`. Os avisos `there is already a transaction in progress` / `there is no transaction in progress`
são esperados (o arquivo tem `begin/commit` e o `-1` também). Um `WARNING: i) ... DIFERENTE` quer dizer que
o que voltou não é igual ao que estava antes: mande a saída (o rollback já foi aplicado; a diferença é para
ser olhada, não desfeita no susto). `lock timeout`: nada mudou, rode de novo em um minuto.

O que o rollback faz com os dados criados depois do deploy (tudo guardado inteiro, em jsonb, em
`public.alerta_bkp_0149_0151_linhas_removidas`): apaga as linhas de fila de **e-mail**, de tipo **emb** e do
Recebimento (A), copia as marcas de EMB avisada antes de apagar a tabela (B), apaga as regras de **Fim de
EMB** (C), e tira o **e-mail** dos canais das regras do ShopFloor que o ganharam (D) — a que ficar sem
canal nenhum volta com Telegram e **desativada** (E), para ninguém ser avisado por um canal que não escolheu.
Depois devolve as 5 funções, as 3 policies e os checks exatamente como eram antes da 0149. Rodar duas vezes
não faz mal (a segunda imprime tudo 0).

**3. PostgREST:**

```bash
cd ~/supabase/docker && docker compose restart rest
```

**4. O SMTP do app** pode ficar (sem o app novo ninguém o lê) ou voltar:
`cp -p ~/ShopFloor/.env.production.antes-fim-de-emb ~/ShopFloor/.env.production && pm2 restart shopfloor --update-env`.
