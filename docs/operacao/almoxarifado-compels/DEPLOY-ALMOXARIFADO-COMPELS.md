# Deploy do Almoxarifado + fila do Compels — migrações 0128, 0129, 0130, 0131, 0132, 0133 e 0153

Este deploy leva para produção o **posto Almoxarifado** (a tela `/recebimento/almoxarifado`, o perfil
`almoxarifado`, a entrada de peça/caixa no estoque, o cancelamento da caixa inteira) e a **fila de envio de
estoque ao Compels** (tabela `sf_estoque_envios`, a rota `/api/shopfloor/estoque` que a esvazia). São **sete
migrações** e o app da `main`.

⚠️ **Duas migrações substituem funções que já rodam em produção:** `sf_nqa_caixa` (a 0130 troca a versão da 0100)
e `sf_cancelar_lancamento` (a 0133 troca a versão da 0106). Tudo o mais é objeto novo. Por isso as sete entram
**numa transação só** (passo 5) e o rollback existe (fim deste arquivo).

## Leia antes de começar — decisões e avisos

1. **O cron NÃO é armado neste deploy.** Nada neste arquivo toca no crontab. A fila só é esvaziada **à mão**
   (a rota chamada manualmente, como o `TESTE-OP-8649.md` ensina), e mesmo assim só para as OPs listadas em
   `COMPELS_OPS_LIBERADAS`. Não arme o cron antes de o teste com a OP 8649 ter passado e de você ter decidido
   liberar as OPs reais.
2. **`COMPELS_OPS_LIBERADAS` começa VAZIA** (passo 7): lista vazia = **nenhuma OP é enviada** ao Compels,
   mesmo com a fila cheia e a rota chamada. O teste acrescenta só a OP 8649.
3. **Permissão nova, atribuída por você, à mão.** A tela do Almoxarifado exige **`recebimento.lancar`** no perfil
   do usuário, **e também `shopfloor.visualizar`** (a tela lê as OPs e os postos do ShopFloor). Nenhuma migração
   concede isso a ninguém: depois do deploy, atribua pela tela de **Perfis**. Sem as duas, a tela mostra um aviso
   de "sem permissão" (não é defeito).
4. **O posto Almoxarifado também não é criado pelo deploy.** A migração 0128 só cria o **perfil**. O posto é
   cadastrado depois (**Cadastrar Posto**, perfil Almoxarifado, e incluído na rota da OP) — o
   `TESTE-OP-8649.md` cria um para o teste. Enquanto não houver posto, a tela abre com o aviso amarelo
   "Não há posto com o perfil Almoxarifado cadastrado": **isso é o esperado** logo depois do deploy.
5. **Pré-requisito: o pacote do Fim de EMB (0149–0151) e a 0152 já aplicados** — o app que sobe aqui contém as
   telas dele. Produção tem que estar em **0152 + 0149–0151** (o bloco 5 do passo 3 confere).

Tudo roda **na instância Lightsail**, no terminal, **um comando por vez, colado como está**. Nenhum comando tem
coisa para trocar. A senha do banco é **digitada** no prompt `Password:` do `-W` (nunca em comando, nunca no chat);
os segredos do Compels são **digitados** nos prompts do passo 7 (a tela não mostra). Se o terminal cair no meio,
volte ao **passo 2** (a variável `HOST` some junto com o terminal).

Os arquivos de apoio ficam no repositório em `docs/operacao/almoxarifado-compels/` (têm que estar na **main**
antes de começar — os comandos leem de `origin/main`):

| arquivo | o que faz | grava? |
|---|---|---|
| `01-conferir-antes.sql` | confere as 2 funções, os objetos novos, o perfil, os pré-requisitos; dá um veredito | **não** (sessão somente leitura) |
| `02-copiar-antes.sql` | guarda a definição e a ACL das 2 funções que as migrações substituem em `public.almox_bkp_objetos` | sim (tabela nova, fechada para o app) |
| `03-rollback.sql` | desfaz as sete migrações e copia a fila para `public.almox_bkp_estoque_envios` — **só** se algo der errado | sim |

**A ordem das migrações NÃO é a dos números.** A ordem válida é **0128 → 0132 → 0129 → 0130 → 0131 → 0133 → 0153**:
a **0132** (a fila e as funções `sf_estoque_chave`/`sf_estoque_reverter`) vai **antes** da 0129 e da 0131, que
chamam funções que nascem nela; a **0133** também chama `sf_estoque_reverter`; a **0153** cria uma função que lê
a tabela da 0132 (é `language sql`: sem a tabela, a criação falha). A 0128 (o perfil) vai primeiro porque a 0129,
a 0131 e a 0133 procuram o perfil pelo nome. Na transação única do passo 5 não existe janela entre elas, mas a
ordem fica certa de qualquer jeito.

---

## Passo 1 — anotar o commit que está no ar e baixar a main

Guarda o commit atual (é para onde o app volta se algo der errado) e busca a main **sem** mexer no código do
disco (o `git pull` aqui faria o `deploy.sh` pular o build):

```bash
cd ~/ShopFloor && git rev-parse HEAD > ~/antes-almox.txt && cat ~/antes-almox.txt && git fetch origin main
```

**Olhar:** aparece um hash (o commit em produção hoje) e o fetch termina sem erro. Confirme que a main já tem o
que vamos usar (tem que imprimir as 7 migrações e os 3 arquivos, sem `fatal`):

```bash
cd ~/ShopFloor && git ls-tree --name-only origin/main supabase/migrations/ | grep -E '/(0128|0129|0130|0131|0132|0133|0153)_' && git ls-tree --name-only origin/main docs/operacao/almoxarifado-compels/
```

## Passo 2 — extrair os arquivos e pegar o host do banco

As sete migrações vão **num arquivo só**, na ordem válida (0128 → 0132 → 0129 → 0130 → 0131 → 0133 → 0153), para
entrarem numa transação só:

```bash
cd ~/ShopFloor && git show origin/main:supabase/migrations/0128_sf_perfil_almoxarifado.sql > /tmp/almox-migracoes.sql && git show origin/main:supabase/migrations/0132_sf_estoque_envios.sql >> /tmp/almox-migracoes.sql && git show origin/main:supabase/migrations/0129_sf_almoxarifado_entrada.sql >> /tmp/almox-migracoes.sql && git show origin/main:supabase/migrations/0130_sf_nqa_caixa_posto_da_caixa.sql >> /tmp/almox-migracoes.sql && git show origin/main:supabase/migrations/0131_sf_cancelar_caixa_almoxarifado.sql >> /tmp/almox-migracoes.sql && git show origin/main:supabase/migrations/0133_cancelar_lancamento_estoque.sql >> /tmp/almox-migracoes.sql && git show origin/main:supabase/migrations/0153_sf_estoque_enviado.sql >> /tmp/almox-migracoes.sql && git show origin/main:docs/operacao/almoxarifado-compels/01-conferir-antes.sql > /tmp/almox-01.sql && git show origin/main:docs/operacao/almoxarifado-compels/02-copiar-antes.sql > /tmp/almox-02.sql && git show origin/main:docs/operacao/almoxarifado-compels/03-rollback.sql > /tmp/almox-03.sql && wc -l /tmp/almox-*
```

```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && echo "HOST ok"
```

**Olhar:** os quatro arquivos com número de linhas (nenhum com 0; o das migrações tem **2133 linhas**) e `HOST ok`.

> As sete migrações **não têm** `begin`/`commit` próprios nem `create index concurrently` (conferido: fora dos
> corpos `$func$`/`$chk$`/`$idx$` só há `alter`, `create`, `drop`, `revoke`, `grant`, `insert`, `do` e `notify`).
> Por isso as sete cabem num `psql -1`. Todos os `create index` são `if not exists` e a tabela é nova, então não há
> trava longa: o único lock relevante é o `create or replace` das duas funções.

## Passo 3 — conferir antes (somente leitura)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/almox-01.sql
```

**Olhar** (cada bloco começa com `== N.` explicando o número). **PARE e mande a saída** se:

- **Bloco 0:** o `banco`/`versao_postgres` não forem os de produção, ou `somente_leitura` não for `on`.
- **Bloco 1:** algum `existe` ou `igual_ao_esperado` = `f` (as 2 funções vivas têm de ser exatamente as das
  migrações 0100 e 0106 — é esse corpo que o rollback devolve). Nas versões: **1** em `sf_nqa_caixa` e
  `sf_cancelar_lancamento`, **0** nas outras sete.
- **Bloco 2:** qualquer `t`, **menos** `ja_existe_copia_bkp` e `ja_existe_copia_fila` (esses são `t` se você já
  rodou o passo 4 / o rollback antes).
- **Bloco 3:** `perfil_almoxarifado_ja_existe` = `t`, ou `postos_com_perfil_almoxarifado` diferente de 0. A lista
  de perfis traz normalmente 9 linhas (a 0128 acrescenta mais uma).
- **Bloco 4:** qualquer `f`.
- **Bloco 5:** `fim_de_emb_aplicado` = `f` (ou qualquer um dos quatro `f`): aplique antes o pacote do Fim de EMB.
- **Bloco 7:** se aparecer sessão "idle in transaction" há mais de um minuto, anote o pid (ela pode segurar o lock
  do passo 5; não a encerre sem avisar).
- **Bloco 8 (o veredito):** tem que dizer **`PRONTO PARA APLICAR`**. Qualquer outra frase = pare.

**Anote** do bloco 6: `total_sf_registros`, `total_sf_ordens`, `total_sf_caixas` e a lista de postos (para
comparar depois). O normal, nesta etapa, é a lista de postos **sem** nenhum Almoxarifado.

## Passo 4 — copiar as definições que as migrações substituem

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/almox-02.sql
```

**Olhar:** na primeira vez, `copiados_agora` = **2** e, no total guardado, as duas funções com os `md5_corpo`
`83966057af3dd2643558b3bb213342a7` (`sf_nqa_caixa`) e `d7d065ebb018cc1825fff09b734a68ab` (`sf_cancelar_lancamento`).
Rodar de novo é seguro (copia 0 e não sobrescreve a primeira cópia). Se der `ERROR`, nada foi gravado: **não siga**
para o passo 5. (As migrações não reescrevem nenhuma linha de dado, por isso a cópia é de definições, não de linhas.)

## Passo 5 — aplicar as sete migrações numa transação só ⚠️ (o passo que só se desfaz com o rollback)

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/almox-migracoes.sql
```

**Olhar:** uma lista de `CREATE FUNCTION` (**9**: 7 novas + as 2 recriadas), `REVOKE` (8), `GRANT` (7), `NOTIFY`
(7), `DO` (5), `CREATE INDEX` (5), `ALTER TABLE` (5), `CREATE TABLE` (1), `INSERT 0 1` (o perfil),
`DROP POLICY` + `CREATE POLICY` (1 de cada), mais **um** aviso `NOTICE: policy "sf_estoque_envios_select" ...
does not exist, skipping` (normal: é o `drop policy if exists` de uma policy que ainda não existia). Termina
**sem** `ERROR`.

- Se aparecer `ERROR`, a transação **inteira** voltou (`-1`): **nenhuma** das sete ficou aplicada (provado no
  ensaio forçando uma falha depois da última). Pare e mande o erro.
- `ERROR: canceling statement due to lock timeout` = alguém estava chamando `sf_nqa_caixa` ou
  `sf_cancelar_lancamento` naquele instante. Nada mudou; espere um minuto e rode o mesmo comando de novo.
- ⚠️ **Não rode este passo duas vezes depois de ter dado certo.** Reaplicar não quebra o banco (as migrações são
  idempotentes), mas só tem sentido depois de um rollback. Cada uma entra **uma vez**.

> **Este é o passo irreversível sem o `03-rollback.sql`.** Ele troca duas funções que o Lançamento, a Inspeção NQA
> e o cancelamento usam todo dia, cria o perfil, a tabela da fila e as sete funções novas. O app velho continua
> funcionando com o banco novo (as duas funções mantêm a assinatura; o que muda é comportamento só do posto
> Almoxarifado, que ainda não existe), então entre este passo e o deploy (passo 8) ninguém percebe nada.

Conferir na hora — as três consultas são só de leitura. **Primeira** (tem que dar `t | t | t | t | 0 | t | 6 | 1 | 7`):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select (select md5(prosrc) = '8fa7cb1d3fcf7000b6fa62c1d592c573' from pg_proc where oid = to_regprocedure('public.sf_nqa_caixa(text,text,text,text,text,text,text,jsonb)')) as nqa_nova_0130, (select md5(prosrc) = 'fb4741ea04c6f20be804b76b11f8ce08' from pg_proc where oid = to_regprocedure('public.sf_cancelar_lancamento(uuid,text)')) as cancelar_nova_0133, (select count(*) = 1 from public.sf_posto_perfis where chave = 'almoxarifado' and recurso = 'almoxarifado') as perfil_almoxarifado, to_regclass('public.sf_estoque_envios') is not null as tabela_fila, (select count(*) from public.sf_estoque_envios) as linhas_na_fila, (select relrowsecurity from pg_class where oid = 'public.sf_estoque_envios'::regclass) as rls_ligada, (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'sf_estoque_envios') as indices_da_fila, (select count(*) from pg_policies where schemaname = 'public' and tablename = 'sf_estoque_envios') as policies_da_fila, (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('sf_sn_na_faixa','sf_almoxarifado_entrada','sf_cancelar_caixa_almoxarifado','sf_estoque_chave','sf_estoque_reverter','sf_estoque_reservar','sf_estoque_enviado')) as funcoes_novas_de_7;"
```

**Segunda** — quem pode executar o quê (a anon key **não** pode chamar nenhuma; só o servidor chama as da fila).
Tem que dar exatamente esta tabela de `anon | authenticated | service_role`:
`entrada f|t|t` · `cancelar_caixa f|t|t` · `chave f|f|f` · `enviado f|f|t` · `reservar f|f|t` · `reverter f|f|f` · `sn_na_faixa f|f|t`.

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select split_part(f.funcao, '(', 1) as funcao, has_function_privilege('anon', to_regprocedure(f.funcao), 'execute') as anon, has_function_privilege('authenticated', to_regprocedure(f.funcao), 'execute') as authenticated, has_function_privilege('service_role', to_regprocedure(f.funcao), 'execute') as service_role from (values ('public.sf_almoxarifado_entrada(text,text,text,text,text,text,integer,text)'), ('public.sf_cancelar_caixa_almoxarifado(uuid,text)'), ('public.sf_estoque_reservar(integer)'), ('public.sf_estoque_enviado(text,text,uuid)'), ('public.sf_estoque_reverter(text,text,text,text,integer)'), ('public.sf_estoque_chave(text,text,text,text,text)'), ('public.sf_sn_na_faixa(text,text,text)')) f(funcao) order by 1;"
```

**Terceira** — o `01` de novo; agora o bloco 8 tem que dizer **`JÁ APLICADO (as 7 migrações estão no banco)`** (e os
blocos 1 e 2 acusam o inverso do passo 3: é o esperado):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/almox-01.sql | sed -n '/== 8\./,$p'
```

## Passo 6 — reiniciar o PostgREST (obrigatório, depois da migração)

```bash
cd ~/supabase/docker && docker compose restart rest
```

**Olhar:** `Container ... rest ... Started`.

## Passo 7 — variáveis de ambiente do app (`.env.production`)

O app precisa de: `ESTOQUE_CRON_SECRET`, `COMPELS_EZPOINT_USUARIO`, `COMPELS_EZPOINT_SENHA`,
`COMPELS_EZPOINT_EMPRESA=enterplak`, `COMPELS_ESTOQUE_ID=217`, `COMPELS_LOCACAO_ID=5314` e
`COMPELS_OPS_LIBERADAS` (**vazia**), além de `ALERTAS_RECEBIMENTO_LIBERADO_PARA` (já está no runbook do Fim de
EMB; o passo 7e só confere e põe se faltar). **Nenhum comando abaixo imprime segredo.** Os valores vão entre aspas
simples (o Next corta um valor sem aspas no `#`), por isso os prompts **recusam e não gravam** nada se o valor
tiver aspa simples, cifrão (`$`) ou barra invertida (`\`) — nesse caso peça outro valor/senha.

**7a. O segredo da rota do cron** — gerado direto para o arquivo (nunca aparece na tela) e **mantido** se já
existir. Faz também a cópia `.env.production.antes-almox` (só a primeira vez) e deixa o arquivo `600`:

```bash
cd ~/ShopFloor && { [ -e .env.production.antes-almox ] || cp -p .env.production .env.production.antes-almox; } && if grep -q '^ESTOQUE_CRON_SECRET=' .env.production; then echo 'ESTOQUE_CRON_SECRET já existe: mantido.'; else { [ -z "$(tail -c1 .env.production)" ] || echo >> .env.production; } && printf "ESTOQUE_CRON_SECRET='%s'\n" "$(openssl rand -hex 24)" >> .env.production && echo 'ESTOQUE_CRON_SECRET gerado e gravado.'; fi && chmod 600 .env.production
```

**7b. Usuário e senha do ezpointweb** — você **digita** (a senha não aparece). Aborta sem gravar se vierem vazios ou
com `'`, `$` ou `\`; se já existiam, substitui:

```bash
cd ~/ShopFloor && read -rp 'Usuário do ezpointweb: ' U && read -rsp 'Senha do ezpointweb: ' S && echo && if [ -z "$U" ] || [ -z "$S" ] || [[ "$U$S" == *\'* ]] || [[ "$U$S" == *\$* ]] || [[ "$U$S" == *\\* ]]; then echo 'PARE: valor vazio ou com aspa simples, cifrao ou barra invertida. NADA foi gravado.'; else { [ -e .env.production.antes-almox ] || cp -p .env.production .env.production.antes-almox; } && sed -i '/^COMPELS_EZPOINT_USUARIO=/d;/^COMPELS_EZPOINT_SENHA=/d' .env.production && { [ -z "$(tail -c1 .env.production)" ] || echo >> .env.production; } && printf "COMPELS_EZPOINT_USUARIO='%s'\nCOMPELS_EZPOINT_SENHA='%s'\n" "$U" "$S" >> .env.production && chmod 600 .env.production && echo 'gravado: COMPELS_EZPOINT_USUARIO e COMPELS_EZPOINT_SENHA'; fi; unset U S
```

**Olhar:** `gravado: COMPELS_EZPOINT_USUARIO e COMPELS_EZPOINT_SENHA`. Se aparecer `PARE: ...`, nada foi gravado.

**7c. Os valores que não são segredo** (empresa, estoque e locação do Compels) e a lista de OPs, que **começa
vazia** (se a linha já existir, ela é mantida):

```bash
cd ~/ShopFloor && { [ -z "$(tail -c1 .env.production)" ] || echo >> .env.production; } && for par in 'COMPELS_EZPOINT_EMPRESA=enterplak' 'COMPELS_ESTOQUE_ID=217' 'COMPELS_LOCACAO_ID=5314'; do sed -i "/^${par%%=*}=/d" .env.production; echo "$par" >> .env.production; done && { grep -q '^COMPELS_OPS_LIBERADAS=' .env.production || echo 'COMPELS_OPS_LIBERADAS=' >> .env.production; } && chmod 600 .env.production && echo 'gravado'
```

**7d. A trava do Recebimento nos Alertas** — põe só se a variável ainda não existir (é um e-mail, não é segredo):

```bash
cd ~/ShopFloor && { grep -q '^ALERTAS_RECEBIMENTO_LIBERADO_PARA=' .env.production || { { [ -z "$(tail -c1 .env.production)" ] || echo >> .env.production; } && echo 'ALERTAS_RECEBIMENTO_LIBERADO_PARA=gptropa@rwtech.com.br' >> .env.production; }; } && grep '^ALERTAS_RECEBIMENTO_LIBERADO_PARA=' .env.production
```

**7e. Conferir (só nomes e tamanhos; os não-segredos aparecem com o valor):**

```bash
cd ~/ShopFloor && ls -l .env.production | cut -c1-10 && grep -E '^(COMPELS_EZPOINT_EMPRESA|COMPELS_ESTOQUE_ID|COMPELS_LOCACAO_ID|COMPELS_OPS_LIBERADAS|ALERTAS_RECEBIMENTO_LIBERADO_PARA)=' .env.production && grep -E '^(ESTOQUE_CRON_SECRET|COMPELS_EZPOINT_USUARIO|COMPELS_EZPOINT_SENHA)=' .env.production | while IFS= read -r l; do v=${l#*=}; v=${v//\'/}; echo "${l%%=*}: ${#v} caracteres"; done
```

**Olhar:** permissão `-rw-------`; `COMPELS_EZPOINT_EMPRESA=enterplak`, `COMPELS_ESTOQUE_ID=217`,
`COMPELS_LOCACAO_ID=5314`, **`COMPELS_OPS_LIBERADAS=`** (nada depois do `=`) e a linha do
`ALERTAS_RECEBIMENTO_LIBERADO_PARA`; e as três linhas de tamanho: `ESTOQUE_CRON_SECRET: 48 caracteres` e as duas do
ezpointweb com tamanho maior que 0. (O app só lê o arquivo ao reiniciar — o passo 8 reinicia.)

## Passo 8 — deploy do app

O `git fetch` do passo 1 já foi feito; **não** rode `git pull` antes deste comando.

```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```

**Olhar:** termina com `==> deploy OK -> <commit da main>`. Esta versão **não** muda o `package-lock.json`
(sem `npm ci`); se mesmo assim aparecer `==> dependências mudaram -> npm ci`, deixe correr (demora alguns
minutos a mais; a instância chega perto de 90% de memória durante o build; não interrompa). Se o build falhar, o
app antigo continua no ar (o `pm2` só reinicia depois de o build passar).

Se aparecer **`Nada novo na main. Deploy não necessário.`**, alguém deu `git pull` antes e o script pulou o build —
o app velho continua no ar e **sem** as variáveis do passo 7. Rode o build e o restart à mão:

```bash
cd ~/ShopFloor && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```

## Passo 9 — smoke pós-deploy (⚠️ não arme o crontab)

**9a. O app subiu e a rota da fila está de pé e trancada.** A rota só aceita `POST` com o segredo; sem segredo e
com o segredo errado tem que dar **401** (ela não esvazia nada nem lê o banco antes de conferir o segredo):

```bash
curl -s -o /dev/null -w 'sem segredo: %{http_code}\n' -X POST http://127.0.0.1:3000/api/shopfloor/estoque ; curl -s -o /dev/null -w 'segredo errado: %{http_code}\n' -X POST -H 'Authorization: Bearer segredo-errado' http://127.0.0.1:3000/api/shopfloor/estoque
```

**Olhar:** `sem segredo: 401` e `segredo errado: 401`. **`503`** = o `ESTOQUE_CRON_SECRET` não chegou ao app (o app
reiniciou sem ler o `.env.production`): rode `cd ~/ShopFloor && pm2 restart shopfloor --update-env` e repita.
**Não** faça a chamada com o segredo certo agora — ela esvaziaria a fila (vazia, sim, mas é exatamente a chamada
que o `TESTE-OP-8649.md` ensina a fazer, com a OP de teste liberada).

**9b. As telas** (no navegador, entrando com o seu usuário):

- [ ] `https://shopfloor.enterplak.com.br/recebimento/almoxarifado` abre. Sem `recebimento.lancar` +
      `shopfloor.visualizar` no seu perfil, aparece o aviso de "sem permissão" (atribua pela tela de **Perfis** e
      recarregue). Com as duas e sem nenhum posto Almoxarifado: o aviso amarelo "Não há posto com o perfil
      Almoxarifado cadastrado". **Qualquer um desses é correto agora.**
- [ ] **Cadastrar Posto** lista o perfil **Almoxarifado** entre as opções.
- [ ] As telas de uso diário seguem normais: o **Lançamento** abre; a **Inspeção NQA** abre (a função
      `sf_nqa_caixa` recriada é a que ela chama ao registrar).
- [ ] Nenhum posto novo apareceu na lista do Lançamento (o posto Almoxarifado ainda não existe).

**9c. Nada foi armado:**

```bash
crontab -l | grep -c 'api/shopfloor/estoque' ; true
```

**Olhar:** `0`. (A linha do crontab só entra depois do teste e da decisão de liberar as OPs reais —
`tools/estoque/README.md` descreve como.)

---

**Depois do deploy, siga o `TESTE-OP-8649.md`** (`docs/operacao/almoxarifado-compels-teste-op8649/`): ele monta a
OP de teste, libera só a OP 8649 em `COMPELS_OPS_LIBERADAS`, bipa e esvazia a fila à mão.

Se tudo passou, as cópias podem ser apagadas **depois** (dias, não agora):
`PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "drop table if exists public.almox_bkp_objetos;"`
(a `almox_bkp_estoque_envios` só existe se um rollback foi feito).

---

## Se algo der errado

**Antes do passo 5:** nada mudou no que o app usa. O passo 4 só criou a tabela de cópia; pode ficar.

**Durante o passo 5 com `ERROR`:** a transação voltou inteira. Nada a desfazer.

**Só as variáveis (passo 7) deram problema:** o banco e o app podem ficar; volte o arquivo e reinicie:
`cp -p ~/ShopFloor/.env.production.antes-almox ~/ShopFloor/.env.production && pm2 restart shopfloor --update-env`.

**Depois do passo 5** (Inspeção NQA ou cancelamento de lançamento quebrados, tela nova com erro, fila com
comportamento estranho), **nesta ordem**:

**1. Primeiro o app volta** para o commit anotado no passo 1 (o app novo chama funções, colunas e a tabela que o
rollback apaga; o app velho funciona com os dois bancos):

```bash
cd ~/ShopFloor && git reset --hard $(cat ~/antes-almox.txt) && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```

**Olhar:** o build termina e o `pm2` reinicia; a rota `/recebimento/almoxarifado` deixa de existir. (O próximo
`deploy.sh` volta para a main normalmente: o `git pull` avança de novo.)

**2. Depois o banco** (precisa do `HOST` do passo 2 e de `/tmp/almox-03.sql`):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=20s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f /tmp/almox-03.sql
```

**Olhar** as linhas `NOTICE`:

- `a) trava ok: nenhum posto usa o perfil almoxarifado` — se em vez disso vier `ERROR: ROLLBACK ABORTADO (nada foi
  alterado): estes postos usam o perfil almoxarifado: ...`, **nada foi mudado**. O posto cadastrado com o perfil
  aponta para a linha que o rollback apaga; troque o perfil dele (**Cadastrar Posto**, escolha outro perfil, por
  exemplo Passagem) e rode o mesmo comando de novo. Se preferir pelo banco (afeta **só** os postos com perfil
  Almoxarifado, que passam a perfil Passagem):

```bash
PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "update public.sf_postos set perfil = 'passagem' where perfil = 'almoxarifado';"
```

- `b) fila copiada para almox_bkp_estoque_envios: N linhas ...` — **anote o N** e os números que vêm junto (já
  enviadas ao Compels, pendentes, estornos, canceladas). ⚠️ Linhas **já enviadas** ao Compels continuam lá: apagar a
  fila do ShopFloor **não desfaz** estoque no ERP; a cópia é o registro do que foi.
- `g) conferência com a cópia do 02: 2 iguais, 0 diferentes, 0 faltando`, `g) sf_nqa_caixa igual à 0100: t`,
  `g) sf_cancelar_lancamento igual à 0106: t`, `g) nenhum objeto novo sobrou` e `COMMIT`. Os avisos `there is
  already a transaction in progress` / `there is no transaction in progress` são esperados (o arquivo tem
  `begin/commit` e o `-1` também). Um `WARNING: g) ... DIFERENTE` ou `SOBROU` quer dizer que o que voltou não é
  igual ao que estava antes: mande a saída (o rollback já foi aplicado; a diferença é para ser olhada, não
  desfeita no susto). `lock timeout`: nada mudou, rode de novo em um minuto.

O rollback devolve `sf_nqa_caixa` (0100) e `sf_cancelar_lancamento` (0106) com as mesmas ACLs, apaga as sete
funções novas, a tabela `sf_estoque_envios` (com índices e policy) e a linha `almoxarifado` de `sf_posto_perfis`.
**Não** apaga o que o Almoxarifado gravou em `sf_registros` (dados da linha ficam). Rodar duas vezes não faz mal.

**3. PostgREST:**

```bash
cd ~/supabase/docker && docker compose restart rest
```

**4. As variáveis do passo 7** podem ficar (sem o app novo ninguém as lê) ou voltar:
`cp -p ~/ShopFloor/.env.production.antes-almox ~/ShopFloor/.env.production && pm2 restart shopfloor --update-env`.
