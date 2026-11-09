# Estoque de destino (PA × EINTER) no Almoxarifado: roteiro

Quem confirma uma entrada no Almoxarifado (caixa, peça avulsa ou lote) passa a poder escolher, **por gravação**, se ela vai para o estoque **PA** ou **EINTER** do Compels. O padrão é o último estoque lançado naquela OP (PA na primeira vez). Qualquer pessoa que confirma pode escolher; o estorno no ERP continua manual.

**A funcionalidade nasce DORMENTE.** O id do estoque EINTER e o da locação dele no Compels ainda não são conhecidos. Enquanto as duas variáveis abaixo não existirem no `.env.production`, a tela **não oferece a escolha** (só PA, exatamente como hoje) e o servidor **recusa** qualquer pedido de EINTER. Dá para subir tudo para produção antes de ter o `.har` e ativar depois, sem novo deploy.

Tudo na **Lightsail**, um bloco de cada vez. A senha do banco é digitada no `Password:`. Nada de senha no chat.

## O que muda
- **Banco (migração 0175):** coluna `sf_estoque_envios.estoque` (`PA` por padrão, `PA` ou `EINTER`); as funções `sf_almoxarifado_entrada` e `sf_almoxarifado_lote` ganham o parâmetro opcional `p_estoque` (a escolha é gravada **na mesma inserção** que cria a linha da fila: o cron, que roda a cada minuto, nunca vê a linha sem o estoque); a linha de **estorno herda** o estoque da entrada que ela desfaz; função de leitura `sf_estoque_ultimo_da_op` (o padrão da tela).
- **App:** seletor PA / EINTER nos cartões da caixa, do lote e das peças avulsas e no painel do posto Almoxarifado do Lançamento; o resultado mostra o estoque; a integração com o Compels grava cada linha no estoque dela.
- **Variáveis novas** (sem valor padrão): `COMPELS_ESTOQUE_EINTER_ID` e `COMPELS_LOCACAO_EINTER_ID`. O PA continua com `COMPELS_ESTOQUE_ID`/`COMPELS_LOCACAO_ID` (padrão 217/5314).

## Ordem de deploy (importante): migração ANTES do app
1. **Migração 0175** no banco de produção.
2. **App** (`deploy.sh`).
3. Só depois, quando o `.har` chegar: **ativar** o EINTER (variáveis).

O que acontece se a ordem sair diferente:
- **App novo antes da migração:** o PA funciona normalmente (o app só envia `p_estoque` quando a escolha é EINTER, então a chamada do PA é idêntica à de antes). A leitura do estoque da linha na fila encontra a coluna inexistente e trata tudo como PA. O EINTER nem aparece na tela enquanto as variáveis não existirem. Se alguém ativasse o EINTER nessa janela, o banco antigo ignoraria o parâmetro desconhecido e daria erro de função inexistente na confirmação (a tela mostra "Não foi possível registrar a entrada"; nada é gravado). Por isso: **não ative o EINTER antes da migração**.
- **Migração antes do app (a ordem certa):** o app antigo continua funcionando; ele chama as funções sem `p_estoque` e cai no padrão `PA`.
- Na migração, as assinaturas antigas das duas funções são derrubadas e as novas criadas **na mesma transação** (`-1`), sem janela em que a chamada não ache função.

## Antes de começar
Opcional: snapshot manual do RDS no console da AWS (a migração só acrescenta uma coluna e recria duas funções). Confirme que não há transação presa (deve vir vazio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pid, state, now() - xact_start as transacao, left(regexp_replace(query, '\s+', ' ', 'g'), 80) as consulta from pg_stat_activity where datname = 'postgres' and state = 'idle in transaction';"
```
Confirme o ponto de partida (as duas funções com a assinatura antiga e a coluna ainda inexistente; deve haver 3 linhas, todas `t`):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select 'entrada com a assinatura da 0165 (8 argumentos)' as item, to_regprocedure('public.sf_almoxarifado_entrada(text,text,text,text,text,text,integer,text)') is not null as ok union all select 'lote com a assinatura da 0165 (6 argumentos)', to_regprocedure('public.sf_almoxarifado_lote(text,text,text,text,uuid,text[])') is not null union all select 'coluna estoque ainda nao existe', not exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_estoque_envios' and column_name='estoque');"
```
Qualquer `f`: **pare** e mande a saída (o banco não está na 0165, que é de onde a 0175 parte).

## Passo 1: a migração
Traz o arquivo (só baixa) e confere:
```bash
cd ~/ShopFloor && git fetch origin main && git show origin/main:supabase/migrations/0175_estoque_destino_almoxarifado.sql > /tmp/0175_estoque_destino_almoxarifado.sql && wc -l /tmp/0175_estoque_destino_almoxarifado.sql
```
Deve mostrar o arquivo com centenas de linhas. Aplica (uma transação; se estourar o `lock timeout`, nada foi gravado: repita):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0175_estoque_destino_almoxarifado.sql
```
Termina com `NOTIFY`, sem erro. Recarrega o PostgREST e confere:
```bash
cd ~/supabase/docker && docker compose restart rest
```
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select 'coluna estoque' as item, exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_estoque_envios' and column_name='estoque') as ok union all select 'entrada: uma só assinatura, com p_estoque', (select count(*) = 1 and bool_and(pronargs = 9) from pg_proc where proname = 'sf_almoxarifado_entrada') union all select 'lote: uma só assinatura, com p_estoque', (select count(*) = 1 and bool_and(pronargs = 7) from pg_proc where proname = 'sf_almoxarifado_lote') union all select 'funcao do padrao da OP', to_regprocedure('public.sf_estoque_ultimo_da_op(text,text)') is not null union all select 'trigger do estorno', exists (select 1 from pg_trigger where tgname = 'sf_estoque_envios_estoque_do_estorno' and not tgisinternal) union all select 'todas as linhas antigas sao PA', not exists (select 1 from public.sf_estoque_envios where estoque <> 'PA');"
```
**Seis linhas, todas `t`.** Qualquer `f`: mande a saída.

## Passo 2: o app
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
Termina com `deploy OK -> <commit da main>`. Se aparecer `Nada novo na main. Deploy não necessário.` (alguém deu `git pull` antes), rode à mão:
```bash
cd ~/ShopFloor && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```
**Conferir (EINTER ainda dormente):** abra o Almoxarifado e confirme uma entrada qualquer. **Não** deve aparecer seletor nenhum; a tela e o resultado são os de sempre. A fila grava `PA`:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select estoque, count(*) from public.sf_estoque_envios group by 1;"
```
Só a linha `PA`.

## Passo 3 (depois, com o `.har` na mão): ativar o EINTER
Do `.har` saem dois números inteiros: o **id do estoque EINTER** e o **id da locação** dele (os equivalentes de 217 e 5314 do PA). Rode o bloco abaixo; ele **pergunta** os dois números, valida que são inteiros positivos, faz cópia do `.env.production`, grava as duas variáveis (trocando se já existirem) e reinicia o app lendo o ambiente novo:
```bash
cd ~/ShopFloor && read -p "ID do estoque EINTER no Compels: " E && read -p "ID da locacao do EINTER no Compels: " L && [[ "$E" =~ ^[1-9][0-9]*$ && "$L" =~ ^[1-9][0-9]*$ ]] && cp -p .env.production .env.production.antes-einter && for par in "COMPELS_ESTOQUE_EINTER_ID=$E" "COMPELS_LOCACAO_EINTER_ID=$L"; do k=${par%%=*}; if grep -q "^$k=" .env.production; then sed -i "s/^$k=.*/$par/" .env.production; else echo "$par" >> .env.production; fi; done && grep -E '^COMPELS_(ESTOQUE|LOCACAO)_EINTER_ID=' .env.production && pm2 restart shopfloor --update-env && pm2 save
```
**Olhar:** imprime as duas linhas com os números digitados. Se digitar algo que não é inteiro positivo, o bloco para sem mexer em nada.

O cron de envio roda dentro do mesmo app (`pm2`), então este restart também faz a integração passar a conhecer o EINTER.

**Conferir (com o EINTER ativo):**
1. Abra o Almoxarifado, num cartão de caixa/lote/peças (e no painel do posto Almoxarifado do Lançamento): aparece **Estoque: PA | EINTER**, com o último da OP pré-selecionado (PA se a OP nunca teve entrada). O resultado da confirmação mostra o chip **Estoque**.
2. Use uma OP **de teste** que esteja em `COMPELS_OPS_LIBERADAS`, confirme **uma** entrada em EINTER e veja a fila:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select chave, estoque, ok, left(coalesce(erro, ''), 80) as erro, criado_em from public.sf_estoque_envios order by criado_em desc limit 5;"
```
A linha nova com `estoque = EINTER`; em até um minuto `ok = t` (o apontamento foi para o estoque EINTER no Compels: confira a OP no ERP). A linha tem que **sair do EINTER certo no ERP**; se o Compels recusar, o motivo aparece no campo `erro`.
3. Cancele essa entrada de teste pela tela de Registros (cancelar caixa/lote): nasce uma linha de **estorno** com o mesmo estoque (`estoque = EINTER`). O estorno no ERP é manual.

Se o EINTER for pedido sem as variáveis (não deveria ser possível pela tela), o servidor recusa com "O estoque EINTER ainda não está disponível neste ambiente"; e uma linha EINTER que já estivesse na fila ficaria **esperando** (sem gastar tentativa) com a mensagem de configuração, e sairia sozinha depois de configurar.

## Rollback

### Desativar o EINTER (sem desfazer nada do deploy)
É só tirar as duas variáveis; a tela volta a só PA. Linhas EINTER **já na fila e não enviadas** ficam esperando (mensagem de configuração) até alguém reativar o EINTER ou tratá-las:
```bash
cd ~/ShopFloor && cp -p .env.production .env.production.antes-desativar-einter && sed -i '/^COMPELS_ESTOQUE_EINTER_ID=/d;/^COMPELS_LOCACAO_EINTER_ID=/d' .env.production && grep -c 'EINTER_ID' .env.production; pm2 restart shopfloor --update-env && pm2 save
```
(o `grep -c` imprime `0`.) Para conferir se sobrou EINTER pendente: `select count(*) from public.sf_estoque_envios where estoque = 'EINTER' and ok = false and cancelado_em is null;`.

### App
Volte ao commit de antes (o hash está no `deploy OK ->` do deploy anterior; ou `git log` no servidor) e refaça o build:
```bash
cd ~/ShopFloor && git log --oneline -5
```
```bash
cd ~/ShopFloor && git reset --hard <hash anterior mostrado acima> && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart shopfloor --update-env && pm2 save
```
O app antigo funciona com o banco novo (a chamada sem `p_estoque` cai no padrão `PA`). **Antes de voltar o app, desative o EINTER** (bloco acima): o app antigo não sabe da coluna e mandaria toda linha EINTER pendente ao PA.

### Banco
`docs/operacao/estoque-destino/rollback-0175.sql` devolve as duas funções às assinaturas e aos corpos da 0165 e tira o trigger e a função de leitura. **A coluna `estoque` fica** (inofensiva; apagá-la perderia o destino de linhas EINTER ainda não enviadas). Só faça depois de **desativar o EINTER** e voltar o app antigo; o arquivo já vem com `begin/commit`:
```bash
cd ~/ShopFloor && git show origin/main:docs/operacao/estoque-destino/rollback-0175.sql > /tmp/rollback-0175.sql && wc -l /tmp/rollback-0175.sql
```
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/rollback-0175.sql
```
Depois, `cd ~/supabase/docker && docker compose restart rest`.

## Pontos conhecidos
- O "último da OP" ignora entradas canceladas e entradas **revertidas por inteiro** (estorno do total); a tela só o usa como pré-seleção, a pessoa sempre pode trocar.
- O acumulado enviado por OP (que a integração compara com o apontado do ERP) soma PA e EINTER juntos: o apontado da OP no Compels é um só.
- Migrações que recriem `sf_almoxarifado_entrada` ou `sf_almoxarifado_lote` daqui para frente têm de partir dos corpos da **0175**, não da 0165 (senão o estoque some da gravação).
- A tela de Estoque pendente (gestor) ainda não mostra o estoque de cada linha; está na coluna `estoque` da fila.
