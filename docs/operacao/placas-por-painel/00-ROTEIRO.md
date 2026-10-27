# Deploy de "placas por painel" (roteiro)

Um bipe de painel passa a contar como N placas (campo **Placas por painel** na OP). Contagem da caixa, progresso da OP, Dashboard, Fluxo, Almoxarifado e fila do Compels passam a andar em **placas**; a amostra do NQA continua em **painéis** (só o total é em placas). Use sempre o último commit da `main` (depois do merge da branch `feat/placas-por-painel`).
Tudo na **Lightsail**, um bloco de cada vez. A senha do banco é digitada no `Password:`. Nada de senha no chat.

## O que este deploy faz
- Aplica no banco de produção, **nesta ordem**, as migrações **0161, 0162, 0163, 0164, 0165 e 0166** (todas aditivas: colunas novas com valor padrão 1 e funções reescritas).
- Sobe o **aplicativo** com as telas e regras novas.
- **O Compels continua desligado** (cron desarmado, nenhuma OP liberada em `COMPELS_OPS_LIBERADAS`): as entradas só ficam na fila, agora com a quantidade em placas.
- OPs que já existem ficam **iguais**: `placas_por_painel = 1` e `pecas = 1` em todos os registros antigos.

## Ordem (importante)
1. **Primeiro as migrações**, depois o aplicativo. O app novo lê `sf_ordens.placas_por_painel` e `sf_placas_embaladas`; o app antigo não conhece nada disso e segue funcionando com o banco novo (colunas com padrão 1).
2. As migrações são aplicadas **uma por vez**, com limite de espera de 3 s (`lock_timeout`). Se estourar, **nada foi gravado**: repita o comando.
3. Escolha um momento de **baixo movimento** (ver o aviso da 0161 abaixo).

## Antes de começar
Opcional: tire um **snapshot manual do RDS** no console da AWS. Dump não é necessário: as migrações só acrescentam colunas e reescrevem funções.

Confirme a última migração aplicada (deve ser a 0160 ou posterior, e **sem** nenhuma 0161+):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_ordens' and column_name='placas_por_painel') as ja_tem_placas_por_painel, (select count(*) from pg_proc where proname='sf_nqa_caixa') as tem_sf_nqa_caixa;"
```
`ja_tem_placas_por_painel` deve vir `f` e `tem_sf_nqa_caixa` deve ser `1` (a 0160 já está lá).

Confirme que não há transação presa (deve vir vazio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pid, state, now() - xact_start as transacao, left(regexp_replace(query, '\s+', ' ', 'g'), 80) as consulta from pg_stat_activity where datname = 'postgres' and state = 'idle in transaction';"
```

## Passo 1: trazer os arquivos (só baixa)
```bash
cd ~/ShopFloor && git fetch origin main && for f in supabase/migrations/0161_placas_por_painel.sql supabase/migrations/0162_placas_progresso_op.sql supabase/migrations/0163_placas_caixa.sql supabase/migrations/0164_placas_dashboard_fluxo.sql supabase/migrations/0165_placas_almoxarifado.sql supabase/migrations/0166_placas_nqa.sql; do git show origin/main:$f > /tmp/$(basename $f) || echo "FALHOU: $f"; done; wc -l /tmp/0161_*.sql /tmp/0162_*.sql /tmp/0163_*.sql /tmp/0164_*.sql /tmp/0165_*.sql /tmp/0166_*.sql
```
Devem aparecer os 6 arquivos com linhas (a 0165 é a maior).

## Passo 2: migrações, na ordem (uma de cada vez; senha no `Password:`)

### Aviso sobre a 0161 (a única com bloqueio relevante)
Ela faz `add constraint ... check` em `sf_registros`, que **valida a tabela inteira** segurando um bloqueio que trava os bipes enquanto roda (na ordem de **centenas de milhares de linhas**, deve levar um ou dois segundos, mas é a única que pode incomodar). Por isso: aplique em **horário calmo** (almoço ou fim do turno, sem ninguém bipando). Com `lock_timeout=3s`, se houver transação aberta na tabela ela desiste sem gravar nada: é só repetir.

**2a. A 0161 (caminho normal):**
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0161_placas_por_painel.sql
```
Deve terminar com `NOTIFY`, sem erro.

**2a'. Plano B (só se a 2a estourar o `lock timeout` repetidas vezes ou a validação demorar demais).** Aplica a mesma migração com a constraint de `sf_registros` criada **sem validar** (quase instantâneo) e valida depois, em um comando separado que **não bloqueia** os bipes. O arquivo da migração não é alterado: a cópia em `/tmp` é ajustada na hora.
```bash
sed 's/check (pecas >= 1);/check (pecas >= 1) not valid;/' /tmp/0161_placas_por_painel.sql > /tmp/0161_novalid.sql && grep -c 'not valid' /tmp/0161_novalid.sql
```
Deve imprimir `1`. Aplique a cópia:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0161_novalid.sql
```
E depois valide (pode ser a qualquer hora, não trava escrita):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -c "alter table public.sf_registros validate constraint sf_registros_pecas_ck;"
```
Deve responder `ALTER TABLE`. (Se a 0161 for reaplicada no futuro, o arquivo original refaz a constraint já validada; é idempotente.)

**2b. A 0162:**
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0162_placas_progresso_op.sql
```
**2c. A 0163** (embalagem: `sf_fechar_caixa`, `sf_lancar`, nova `sf_placas_embaladas`):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0163_placas_caixa.sql
```
**2d. A 0164** (Dashboard e Fluxo):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0164_placas_dashboard_fluxo.sql
```
**2e. A 0165** (Almoxarifado; a maior):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0165_placas_almoxarifado.sql
```
**2f. A 0166** (NQA):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0166_placas_nqa.sql
```
Cada uma termina com `CREATE FUNCTION`/`NOTIFY` sem erro. Se uma abortar com `lock timeout`, repita só essa. Se abortar com outro erro, **pare** e me mande a mensagem inteira (cada arquivo é uma transação: o que falhou não gravou nada, e as anteriores já estão aplicadas, o que é seguro).

## Passo 3: recarregar o PostgREST e conferir
```bash
cd ~/supabase/docker && docker compose restart rest
```
```bash
docker ps --filter name=supabase-rest --format '{{.Names}} {{.Status}}'
```
Deve mostrar `Up` e, depois de alguns segundos, `(healthy)`.

Conferência (colunas, trigger e funções):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select 'coluna sf_ordens.placas_por_painel' as item, exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_ordens' and column_name='placas_por_painel') as ok union all select 'coluna sf_registros.pecas', exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_registros' and column_name='pecas') union all select 'trigger sf_registros_pecas', exists (select 1 from pg_trigger where tgname='sf_registros_pecas' and not tgisinternal) union all select 'constraint sf_registros_pecas_ck validada', coalesce((select convalidated from pg_constraint where conname='sf_registros_pecas_ck'), false) union all select 'funcao ' || f, exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=f and pg_get_functiondef(p.oid) ~ 'pecas|placas_por_painel') from unnest(array['sf_ops_com_bipes','sf_fechar_caixa','sf_lancar','sf_placas_embaladas','sf_dashboard_totais','sf_dashboard_grade','sf_fluxo_op','sf_fluxo_periodo','sf_producao_periodo','sf_almox_necessidades','sf_almoxarifado_entrada','sf_cancelar_lancamento','sf_almox_lotes','sf_almoxarifado_lote','sf_cancelar_lote_almoxarifado','sf_cancelar_caixa_almoxarifado','sf_almox_pendencias','sf_almox_detalhe','sf_nqa_caixa','sf_nqa_individual']) as f;"
```
**Todas** as linhas devem ter `ok = t` (4 de estrutura + 20 funções). Qualquer `f`: me mande a saída.

Conferência dos dados antigos (nada pode ter mudado de peso):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select (select count(*) from public.sf_ordens where placas_por_painel <> 1) as ordens_diferentes_de_1, (select count(*) from public.sf_registros where pecas <> 1) as registros_diferentes_de_1;"
```
As duas contagens devem ser `0` (antes do smoke).

## Passo 4: deploy do aplicativo (reinicia o app por alguns segundos)
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
Termina com `deploy OK -> <código do último commit da main>`. Se o build falhar, o script **para antes de reiniciar**: me mande o final da saída.

## Passo 5: smoke guiado numa OP de TESTE
Use um PMO/OP **claramente de teste** (ex.: PMO `PMOTESTE01`, OP `9901`). Os registros ficam no Prod: anote o PMO/OP para limpar depois. Mantenha o Compels **desligado**.

1. **Criar a OP** (Cadastrar OP): **Placas por painel = 50**, **Qtd = 5000** placas (o campo **Painéis** deve mostrar **100** sozinho). Faixa de SN em painéis (use uma faixa de 100).
2. **Embalagem coletiva, limite 500:** informe o limite 500 e bipe painéis. O contador deve andar de 50 em 50: **50/500, 100/500 ... 500/500**. O **11º bipe é recusado** (caixa cheia).
3. **Fechar a caixa:** o código gerado deve ser `CX[1][500]` + OP/PMO (formato `CX[seq][qtd]OP-PMO`).
4. **NQA da caixa:** deve pedir amostra sobre **10 painéis (3)** e mostrar **total 500** (placas).
5. **Almoxarifado:** a caixa aparece com **500**. Na fila (`sf_estoque_envios`) a quantidade deve ser 500:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select * from public.sf_estoque_envios order by 1 desc limit 3;"
```
   A linha da OP de teste deve ter `quantidade = 500` e continuar **na fila** (não enviada, pois o Compels está desligado).
6. **Dashboard:** total **500** e progresso **500/5000** para a OP de teste. O Fluxo da OP mostra o mesmo.
7. **Trava de edição:** em Cadastrar OP, tente editar **Placas por painel** da OP de teste (que já tem bipes): deve ser **bloqueado** com mensagem.
8. Confira que uma OP **antiga** (qualquer uma em andamento) continua com os mesmos números de antes (peso 1).

Se algo divergir, **pare** e me mande o que apareceu na tela (print) e a hora.

## Rollback
- **Colunas** (`sf_ordens.placas_por_painel`, `sf_registros.pecas`) e a função `sf_placas_embaladas`: aditivas, **deixe**. Com peso 1 nada muda.
- **App:** `bash ~/rollback-janela.sh app` (volta ao commit anterior). O app antigo ignora as colunas novas.
- **Voltar o comportamento do banco** (só se for necessário): dropar o trigger e reaplicar as definições anteriores das funções, uma por vez, com `-1 -v ON_ERROR_STOP=1`, extraindo cada função **do arquivo da última migração anterior que a definiu**:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=3s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -c "drop trigger if exists sf_registros_pecas on public.sf_registros;"
```
Onde buscar a definição anterior de cada função (o arquivo está em `supabase/migrations/`; reaplicar só o bloco `create or replace function` dela, nunca o arquivo inteiro de uma migração antiga):

| Função | Definição anterior em |
|---|---|
| `sf_ops_com_bipes` | `0120_sf_ops_com_bipes_contagem.sql` |
| `sf_fechar_caixa` | `0100_caixa_reprovada_revisao.sql` |
| `sf_lancar` | `0103_rota_reteste_obrigatoria.sql` |
| `sf_dashboard_totais`, `sf_dashboard_grade` | `0105_sf_dashboard_filtro_clique.sql` |
| `sf_fluxo_op` | `0157_sf_fluxo_op_burnin_primeira.sql` |
| `sf_fluxo_periodo` | `0090_sf_fluxo_periodo.sql` |
| `sf_producao_periodo` | `0093_sf_producao_periodo.sql` |
| `sf_almox_necessidades`, `sf_almoxarifado_entrada` | `0155_sf_almox_posto_anterior.sql` |
| `sf_cancelar_lancamento`, `sf_almox_lotes`, `sf_almoxarifado_lote`, `sf_cancelar_lote_almoxarifado` | `0156_sf_almox_lote.sql` |
| `sf_cancelar_caixa_almoxarifado` | `0131_sf_cancelar_caixa_almoxarifado.sql` |
| `sf_almox_pendencias` | `0158_sf_almox_pendencias.sql` |
| `sf_almox_detalhe` | `0159_sf_almox_detalhe.sql` |
| `sf_nqa_caixa` | `0160_sf_nqa_caixa_plano_estavel.sql` |
| `sf_nqa_individual` | `0097_sf_nqa_individual.sql` |

Depois: `cd ~/supabase/docker && docker compose restart rest`. (`sf_placas_embaladas` e as colunas ficam; não atrapalham.) Me peça o rollback preparado se precisar: é mais seguro eu gerar o arquivo único a partir desta tabela.

## Lembretes
- **Não normalizar** o sufixo `_` das OPs (`PMOC50_`, `8504_` são válidas, segunda leva).
- A OP de teste e seus registros/caixas ficam no Prod: **limpar depois** (anote PMO/OP).
- Compels segue **desligado**; só liberar com OP de teste real, depois de conferir a quantidade em placas na fila.
- Trava: `placas_por_painel` não pode mudar em OP que já tem registros; para corrigir uma OP errada, cancelar os lançamentos antes.
