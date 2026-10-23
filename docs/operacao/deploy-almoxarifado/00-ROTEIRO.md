# Deploy do Almoxarifado em cartões (roteiro)

Main de referência: `fd52957` (tela em cartões com caixa, lote com todos os números de série e peças avulsas).
Tudo na **Lightsail**, um bloco de cada vez. A senha do banco é digitada no `Password:`. Nada de senha no chat.

## O que este deploy faz
- Sobe o **aplicativo** (tela nova do Almoxarifado, mensagens do NQA já estão no ar).
- Aplica no banco de produção, **nesta ordem**, as migrações **0155, 0156, 0158 e 0159** (a 0160 já está lá).
- Cria o **posto Almoxarifado**.
- **O Compels continua desligado** (cron desarmado, nenhuma OP liberada em `COMPELS_OPS_LIBERADAS`): as entradas só ficam na fila.

## Ordem (importante)
1. **Primeiro o código do aplicativo**, depois as migrações. O enviador do Compels precisa conhecer o tipo `lote` **antes** da 0156.
2. As migrações são aplicadas **uma por vez**, com limite de espera de 3 s (`lock_timeout`). Se estourar, **nada foi gravado**: repita o comando.

## Antes de começar (1 minuto)
Escolha um momento sem muita gente bipando (o app reinicia por alguns segundos). Opcional: tire um **snapshot manual do RDS** no console da AWS.

Confirme que não há transação presa (deve vir vazio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pid, state, now() - xact_start as transacao, left(regexp_replace(query, '\s+', ' ', 'g'), 80) as consulta from pg_stat_activity where datname = 'postgres' and state = 'idle in transaction';"
```

## Passo 1: trazer os arquivos (só baixa)
```bash
cd ~/ShopFloor && git fetch origin main && for f in supabase/migrations/0155_sf_almox_posto_anterior.sql supabase/migrations/0156_sf_almox_lote.sql supabase/migrations/0158_sf_almox_pendencias.sql supabase/migrations/0159_sf_almox_detalhe.sql docs/operacao/deploy-almoxarifado/01-criar-posto-almoxarifado.sql docs/operacao/deploy-almoxarifado/02-conferir-e-medir.sql; do git show origin/main:$f > /tmp/$(basename $f) || echo "FALHOU: $f"; done; wc -l /tmp/0155_*.sql /tmp/0156_*.sql /tmp/0158_*.sql /tmp/0159_*.sql /tmp/01-criar-posto-almoxarifado.sql /tmp/02-conferir-e-medir.sql
```
Devem aparecer os 6 arquivos com linhas (a 0156 é a maior, mais de mil).

## Passo 2: deploy do aplicativo (reinicia o app por alguns segundos)
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
Termina com `deploy OK -> fd52957...`. Se o build falhar, o script **para antes de reiniciar**: me mande o final da saída.
Até as migrações serem aplicadas, a tela do Almoxarifado mostra um erro ao carregar a lista (esperado, dura poucos minutos). As outras telas não são afetadas.

## Passo 3: migrações, na ordem (uma de cada vez; senha no `Password:`)
**3a. A 0155:**
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0155_sf_almox_posto_anterior.sql
```
**3b. A 0156** (a maior; cria um índice e uma coluna, leva menos de 1 s de bloqueio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0156_sf_almox_lote.sql
```
**3c. A 0158:**
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0158_sf_almox_pendencias.sql
```
**3d. A 0159:**
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0159_sf_almox_detalhe.sql
```
Cada uma termina com `CREATE FUNCTION`/`NOTIFY` sem erro. Se uma abortar com `lock timeout`, repita só essa. Se abortar com outro erro, **pare** e me mande a mensagem inteira.

## Passo 4: recarregar o PostgREST
```bash
cd ~/supabase/docker && docker compose restart rest
```
Depois confirme:
```bash
docker ps --filter name=supabase-rest --format '{{.Names}} {{.Status}}'
```
Deve mostrar `Up` e, depois de alguns segundos, `(healthy)`.

## Passo 5: criar o posto Almoxarifado
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -f /tmp/01-criar-posto-almoxarifado.sql
```
No fim deve aparecer **uma linha**: `Almoxarifado | ... | almoxarifado | almoxarifado`.

## Passo 6: conferir e medir
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/02-conferir-e-medir.sql
```
- As **6 funções** devem aparecer com `ok = t`.
- O plano da lista deve mostrar **Execution Time** de poucos milissegundos (com ainda nenhuma OP com o posto, é ~1 ms). Acima de **200 ms**: me mande a saída.

## Passo 7: teste na tela
Abra `https://shopfloor.enterplak.com.br/recebimento/almoxarifado` com um usuário que tenha **Recebimento (lançar)** e **ShopFloor (visualizar)**. Deve abrir **sem erro** e mostrar "Nada esperando confirmação no Almoxarifado agora." (só vai ter cartões quando existir OP com o posto Almoxarifado na rota).

## Rollback
- **App:** `bash ~/rollback-janela.sh app` (volta ao commit anterior).
- **Banco:** as migrações são aditivas. O app antigo não chama nada novo, então pode deixar. Reverter as funções é por reaplicação das versões antigas (me peça).

## O que continua pendente depois do deploy
- Colocar o posto Almoxarifado na rota das **OPs novas** (não mexe nas antigas).
- Mensagens de erro do Almoxarifado ainda genéricas (aplicar o padrão do NQA).
- Compels: OP do teste real; liberar a OP, rodar manualmente, só então armar o cron.
