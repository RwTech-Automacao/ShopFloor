# Deploy do alerta "Parado no Almoxarifado" (roteiro)

Novo tipo de regra de alerta, `parado`: avisa (Telegram/Discord) quando há caixa, lote ou peças esperando entrada no Almoxarifado além de um limite em horas (1 a 72), **uma mensagem por OP** listando os itens; quando a entrada é dada, a ocorrência normaliza sozinha. Use sempre o último commit da `main` (depois do merge da branch `feat/alerta-almox-parado`).
Tudo na **Lightsail**, um bloco de cada vez. A senha do banco é digitada no `Password:`. Nada de senha no chat.

> **A 0167 recria três funções públicas do Almoxarifado como cascas finas (mesmo contrato e mesmos grants) e as de leitura do cron como `_base`.**
> `sf_almox_pendencias`, `sf_almox_necessidades` e `sf_almox_lotes` continuam com a mesma assinatura, o mesmo retorno e `authenticated` executando; elas só checam a permissão e delegam para `sf_almox_pendencias_base`, `sf_almox_necessidades_base` e `sf_almox_lotes_base` (sem checagem de permissão, porque o cron roda como serviço, sem usuário; só o `service_role` executa as `_base`). A tela do Almoxarifado, as entradas e os lotes não mudam. Recomendo um **snapshot manual do RDS** antes (as mudanças são só de funções e uma coluna, mas três funções em uso pela tela do Almoxarifado merecem o snapshot).

## O que este deploy faz
- Aplica no banco **uma** migração, a **0167** (aditiva e idempotente): coluna `alerta_regras.limite_horas`, tipo `parado` nas constraints, as três funções `_base`, as três públicas viram cascas, e `alerta_avaliar` ganha o 4º parâmetro `p_parados` (a assinatura de 3 parâmetros é removida).
- Sobe o **aplicativo** com o tipo novo (formulário, mensagem, cálculo das horas de turno no app).
- Nenhuma regra `parado` existe até alguém criar uma: depois do deploy, os alertas atuais seguem iguais.
- **Ganho colateral:** a 0165 que já está em produção tem, nas **peças avulsas** (OP individual cujo posto anterior ao Almoxarifado não é NQA), um plano ruim em OP **nova e sem estatística** (o planejador estima 1 linha, escolhe Nested Loop Anti Join e reexecuta o conjunto "já entrou" uma vez por SN; no Docker, com 10 mil registros, ~2,9 s contra ~23 ms). A 0167 corrige isso (`with ja as materialized`) também para a **tela do Almoxarifado**, então ela tem valor mesmo sem o alerta. Em produção o autovacuum costuma analisar as tabelas, então o efeito real tende a ser menor que o do Docker; não é uma emergência, é uma melhoria de plano estável.

## Ordem (importante)
1. **Primeiro a migração, depois o aplicativo.** O app novo lê `limite_horas` na consulta das regras: o app novo **antes** da migração quebra `listarRegras` para **todos** os tipos de regra (não só o novo) e o cron de alertas para de funcionar. O app antigo, ao contrário, segue funcionando com o banco novo (chama `alerta_avaliar` com 3 parâmetros nomeados, que a função de 4 aceita).
2. A migração é uma transação só (`-1`), com limite de espera de 5 s (`lock_timeout`). Se estourar, **nada foi gravado**: repita o comando.
3. Escolha um momento de **baixo movimento** (almoço ou fim de turno), por causa do `alter table` em `alerta_regras` (tabela pequena) e do `drop/create` das funções.

## Antes de começar
Recomendado: **snapshot manual do RDS** no console da AWS. Dump não é necessário.

Confirme o ponto de partida (**12 linhas esperadas, todas com `ok = t`**; a linha 1 vale `t` quando a coluna **ainda não** existe):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select item, ok from (values (1, 'AINDA NAO tem alerta_regras.limite_horas', not exists (select 1 from information_schema.columns where table_schema='public' and table_name='alerta_regras' and column_name='limite_horas')), (2, 'alerta_avaliar de 3 parametros', to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb)') is not null), (3, 'AINDA NAO tem alerta_avaliar de 4 parametros', to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb,jsonb)') is null), (4, 'sf_almox_pendencias', to_regprocedure('public.sf_almox_pendencias()') is not null), (5, 'sf_almox_necessidades', to_regprocedure('public.sf_almox_necessidades(text,text)') is not null), (6, 'sf_almox_lotes', to_regprocedure('public.sf_almox_lotes(text,text)') is not null), (7, 'AINDA NAO tem sf_almox_pendencias_base', to_regprocedure('public.sf_almox_pendencias_base()') is null), (8, 'sf_almox_posto_anterior', to_regprocedure('public.sf_almox_posto_anterior(uuid,text)') is not null), (9, 'tabela alerta_ocorrencias', to_regclass('public.alerta_ocorrencias') is not null), (10, 'tabela alerta_regras', to_regclass('public.alerta_regras') is not null), (11, 'sf_almox_pendencias da 0165 (placas)', coalesce((select pg_get_functiondef(p.oid) like '%pecas%' from pg_proc p where p.oid = to_regprocedure('public.sf_almox_pendencias()')), false)), (12, 'so ha UMA alerta_avaliar', (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) = 1)) as t(n, item, ok) order by n;"
```
Qualquer `f`: **pare** e me mande a saída (o banco não está no ponto de partida esperado).

Confirme que não há transação presa (deve vir vazio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pid, state, now() - xact_start as transacao, left(regexp_replace(query, '\s+', ' ', 'g'), 80) as consulta from pg_stat_activity where datname = 'postgres' and state = 'idle in transaction';"
```

## Passo 1: trazer os arquivos (só baixa)
```bash
cd ~/ShopFloor && git fetch origin main && for f in supabase/migrations/0167_alerta_almox_parado.sql docs/operacao/alerta-almox-parado/01-medir.sql docs/operacao/alerta-almox-parado/02-simulacao.sql; do git show origin/main:$f > /tmp/$(basename $f) || echo "FALHOU: $f"; done; wc -l /tmp/0167_alerta_almox_parado.sql /tmp/01-medir.sql /tmp/02-simulacao.sql
```
Devem aparecer os três arquivos com linhas (a 0167 tem pouco mais de mil).

## Passo 2: aplicar a migração (senha no `Password:`)
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=5s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0167_alerta_almox_parado.sql
```
Deve terminar com `NOTIFY`, sem `ERROR`. (Avisos "does not exist, skipping" são normais.) Se abortar com `lock timeout`, repita. Com qualquer outro erro, **pare** e me mande a mensagem inteira: é uma transação só, nada foi gravado.

## Passo 3: recarregar o PostgREST e conferir
```bash
cd ~/supabase/docker && docker compose restart rest
```
```bash
docker ps --filter name=supabase-rest --format '{{.Names}} {{.Status}}'
```
Deve mostrar `Up` e, depois de alguns segundos, `(healthy)`.

Conferência (**14 linhas, todas `ok = t`**):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select item, ok from (values (1, 'coluna alerta_regras.limite_horas', exists (select 1 from information_schema.columns where table_schema='public' and table_name='alerta_regras' and column_name='limite_horas')), (2, 'EXATAMENTE UMA alerta_avaliar', (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) = 1), (3, 'ela tem 4 parametros', to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb,jsonb)') is not null), (4, 'alerta_avaliar so para service_role (authenticated NAO)', not has_function_privilege('authenticated', 'public.alerta_avaliar(text,jsonb,jsonb,jsonb)', 'execute') and has_function_privilege('service_role', 'public.alerta_avaliar(text,jsonb,jsonb,jsonb)', 'execute')), (5, 'pendencias_base NAO executavel por authenticated/anon', not has_function_privilege('authenticated', 'public.sf_almox_pendencias_base()', 'execute') and not has_function_privilege('anon', 'public.sf_almox_pendencias_base()', 'execute')), (6, 'necessidades_base NAO executavel por authenticated/anon', not has_function_privilege('authenticated', 'public.sf_almox_necessidades_base(text,text)', 'execute') and not has_function_privilege('anon', 'public.sf_almox_necessidades_base(text,text)', 'execute')), (7, 'lotes_base NAO executavel por authenticated/anon', not has_function_privilege('authenticated', 'public.sf_almox_lotes_base(text,text)', 'execute') and not has_function_privilege('anon', 'public.sf_almox_lotes_base(text,text)', 'execute')), (8, 'as 3 _base executaveis pelo service_role', has_function_privilege('service_role', 'public.sf_almox_pendencias_base()', 'execute') and has_function_privilege('service_role', 'public.sf_almox_necessidades_base(text,text)', 'execute') and has_function_privilege('service_role', 'public.sf_almox_lotes_base(text,text)', 'execute')), (9, 'sf_almox_pendencias executavel por authenticated', has_function_privilege('authenticated', 'public.sf_almox_pendencias()', 'execute')), (10, 'sf_almox_necessidades executavel por authenticated', has_function_privilege('authenticated', 'public.sf_almox_necessidades(text,text)', 'execute')), (11, 'sf_almox_lotes executavel por authenticated', has_function_privilege('authenticated', 'public.sf_almox_lotes(text,text)', 'execute')), (12, 'as 3 publicas NAO executaveis por anon', not has_function_privilege('anon', 'public.sf_almox_pendencias()', 'execute') and not has_function_privilege('anon', 'public.sf_almox_necessidades(text,text)', 'execute') and not has_function_privilege('anon', 'public.sf_almox_lotes(text,text)', 'execute')), (13, 'nenhuma regra parado ainda', not exists (select 1 from public.alerta_regras where tipo = 'parado')), (14, 'regras antigas intactas (limite_horas nulo)', not exists (select 1 from public.alerta_regras where limite_horas is not null))) as t(n, item, ok) order by n;"
```
Qualquer `f`: **pare** e me mande a saída.

Mede o custo da leitura nova no banco real (só leitura; rode duas vezes; critério: **<= 300 ms** por OP de 10 mil registros, e na produção costuma ser bem menos). Olhe a linha final `Execution Time`:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/01-medir.sql | tail -n 6
```
Se passar de uns 1500 ms, **pare** e me mande o número (a função roda a cada 5 minutos sobre todas as OPs ativas).

**Confira a TELA do Almoxarifado (o app ainda é o antigo).** A 0167 recriou `sf_almox_pendencias`, `sf_almox_necessidades` e `sf_almox_lotes`, e as 14 linhas acima só olham grants, não o resultado. Peça a alguém com a permissão `recebimento.lancar` para abrir **Recebimento > Almoxarifado** e conferir: (a) a lista de pendências é a **mesma de antes** de aplicar (caixas, lotes e peças avulsas das OPs ativas, com as mesmas quantidades); (b) abrir **uma caixa** e **um lote** mostra o detalhe normal (placas e SNs). Compare com o que a pessoa viu antes de aplicar a migração (peça um print da tela antes do Passo 2). Se divergir ou der erro, **pare** e use a seção **Rollback** (banco).

Conferência de que os alertas atuais seguem avaliando (o app ainda é o **antigo**, chamando `alerta_avaliar` com 3 parâmetros): o cron faz isso sozinho a cada 5 minutos. Dispare uma vez e olhe o log (a rotina é a normal do dia a dia; ela pode enviar um alerta real se houver uma ocorrência pendente, como já faria):
```bash
curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar ; echo ; tail -n 3 ~/alertas.log
```
Deve responder um JSON de resumo (sem `erro`). Se vier `Banco indisponível`/503, **pare** e me mande a resposta e o `tail` do log.

## Passo 4: deploy do aplicativo (reinicia o app por alguns segundos)
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
Termina com `deploy OK -> <código do último commit da main>`. Se o build falhar, o script **para antes de reiniciar**: me mande o final da saída.

Depois do deploy, confira o cron de novo (agora com o app **novo**, que manda `p_parados`):
```bash
curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar ; echo ; tail -n 3 ~/alertas.log
```
Deve responder o JSON de resumo, sem `erro`. Abra também a tela de **Alertas** no navegador: a lista de regras deve carregar (prova de que a consulta com `limite_horas` funciona) e o tipo **Parado no Almoxarifado** deve aparecer ao criar uma regra.

## Passo 5: smoke guiado numa OP de TESTE
Use um PMO/OP **claramente de teste** (ex.: PMO `PMOTESTE01`, OP `9901`, com o posto Almoxarifado na rota e uma OP coletiva, para ter caixa). Anote para limpar depois.

1. **Criar a regra** (Alertas > Nova regra): tipo **Parado no Almoxarifado**, **limite 1 h**, postos = o posto **Almoxarifado**, **PMO = o de teste** (para não alertar OPs reais), com um **responsável com Telegram/Discord vinculado** (o seu), lembrete desligado ou longo.
2. **Deixar uma caixa pronta** no posto anterior (Embalagem): feche uma caixa da OP de teste (Lançamento) e **não** dê a entrada no Almoxarifado.
3. **Envelhecer** a caixa para ficar acima de 1 h sem esperar (opcional; senão aguarde 1 h de **expediente** do turno da regra). Só na OP de teste, um comando:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -c "update public.sf_caixas set fechada_em = fechada_em - interval '3 hours' where pmo = 'PMOTESTE01' and op = '9901' and fechada returning pmo, op, seq, codigo, fechada_em;"
```
   (O cálculo de horas é o de expediente: fora do turno ou no fim de semana o relógio não anda; o esperado é a caixa aparecer com 3 h a mais.)
4. **Ver a mensagem:** em até 5 minutos (ou dispare o `curl` do passo 4) chega **uma única mensagem por OP**, listando a caixa (código, peças, há quanto tempo). A tela de **Alertas > Ocorrências** mostra uma ocorrência cuja chave é `PMO/OP`.
5. **Dar a entrada** da caixa no Almoxarifado (Lançamento, posto Almoxarifado) e disparar o `curl` de novo: a ocorrência **normaliza** e chega a mensagem de normalização.
6. **Limpar:** apague a regra de teste (Alertas) e os registros de teste (cancele os lançamentos pela tela de Cancelamentos, como nos outros smokes). Anote o PMO/OP.

Se algo divergir, **pare** e me mande o que apareceu (print, hora).

## Passo 6: simulação ANTES da primeira regra de produção
Sem piso de idade, o primeiro ciclo de uma regra abre **uma ocorrência por OP** para tudo o que já estiver parado. Sobras antigas de OPs que nunca foram finalizadas voltariam a alertar para sempre (a cada `lembrete_min` e, depois de **Resolver**, a cada 60 min). Veja o que a regra enxergaria antes de criá-la (só leitura):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/02-simulacao.sql
```
Saem duas tabelas: os itens (do mais antigo ao mais novo, com `horas_relogio`) e o resumo por OP (itens, placas, idade do mais antigo). O alerta conta horas de **expediente** (menos que o relógio), então a idade real do alerta é menor que a mostrada. O que olhar: itens de **semanas ou meses** (sobras de OPs abandonadas) e OPs com muitos itens. Para esses, antes de criar a regra: finalize ou cancele a OP/entrada, ou comece a regra com um **filtro de PMO** restrito às OPs vivas. Mande-me a saída se houver dúvida.

## Rollback
Ordem importante: o app antigo **não lista** regras `parado` (não dá para apagá-las pela tela) e o `alerta_avaliar` da 0151 **nunca fecha** ocorrência `parado`; ficariam `aberta` para sempre. Por isso, **antes** de voltar o app ou o banco, desative as regras `parado` e normalize as ocorrências vivas (uma transação, só mexe em `parado`):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -c "update public.alerta_ocorrencias oc set estado='normalizada', normalizada_em=now() from public.alerta_regras rg where rg.id=oc.regra_id and rg.tipo='parado' and oc.estado in ('aberta','resolvida'); update public.alerta_regras set ativa=false where tipo='parado';"
```
Deve responder `UPDATE n` e `UPDATE m`. Depois:
- **App:** `bash ~/rollback-janela.sh app` (volta ao commit anterior). O app antigo roda com o banco **novo** sem problema (chama `alerta_avaliar` com 3 parâmetros nomeados; ele não conhece o tipo `parado`, então regras `parado` existentes são ignoradas).
- **Banco** (só se for preciso voltar o banco): recria `alerta_avaliar` de 3 parâmetros a partir da 0151 e as três funções públicas a partir da 0165, depois remove as três `_base`. A coluna `limite_horas` e as constraints **ficam** (inofensivas). O arquivo gerado abaixo já **começa** pela desativação das regras `parado` (a mesma do bloco acima, repetida por segurança: antes de dropar e recriar funções).
  Monta o arquivo de rollback (só gera o arquivo, não toca o banco) a partir do `origin/main`; cada bloco vai do `create or replace function` ao `$func$;` seguinte:
```bash
cd ~/ShopFloor && git fetch origin main && ext() { git show "origin/main:$1" | awk -v s="$2" 'index($0,s)==1{p=1} p{print} p&&/^(end )?\$func\$;/{exit}'; } && { echo "update public.alerta_ocorrencias oc set estado='normalizada', normalizada_em=now() from public.alerta_regras rg where rg.id=oc.regra_id and rg.tipo='parado' and oc.estado in ('aberta','resolvida');"; echo "update public.alerta_regras set ativa=false where tipo='parado';"; echo; echo "drop function if exists public.alerta_avaliar(text, jsonb, jsonb, jsonb);"; ext supabase/migrations/0151_alertas_canal_email.sql 'create or replace function public.alerta_avaliar('; echo; ext supabase/migrations/0165_placas_almoxarifado.sql 'create or replace function public.sf_almox_necessidades('; echo; ext supabase/migrations/0165_placas_almoxarifado.sql 'create or replace function public.sf_almox_lotes('; echo; ext supabase/migrations/0165_placas_almoxarifado.sql 'create or replace function public.sf_almox_pendencias('; echo; echo "drop function if exists public.sf_almox_pendencias_base();"; echo "drop function if exists public.sf_almox_necessidades_base(text, text);"; echo "drop function if exists public.sf_almox_lotes_base(text, text);"; echo "revoke all on function public.alerta_avaliar(text, jsonb, jsonb) from public, anon, authenticated;"; echo "grant execute on function public.alerta_avaliar(text, jsonb, jsonb) to service_role;"; echo "notify pgrst, 'reload schema';"; } > /tmp/rollback-0167.sql && grep -c 'create or replace function' /tmp/rollback-0167.sql && wc -l /tmp/rollback-0167.sql
```
  Deve imprimir `4` (as quatro funções recriadas) e o total de linhas (perto de 900). O arquivo termina com o `revoke`/`grant` de `alerta_avaliar` de 3 parâmetros (só `service_role`, como na 0151). Aplique:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=5s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/rollback-0167.sql
```
```bash
cd ~/supabase/docker && docker compose restart rest
```
  Me peça o rollback preparado se precisar: é mais seguro eu gerar o arquivo único e conferi-lo antes.

## Pontos conhecidos
- O primeiro ciclo depois de criar uma regra `parado` avisa de **tudo** que já estiver parado acima do limite naquele momento (alertar o que está parado agora é o comportamento desejado). Crie a regra de produção depois do smoke e **depois da simulação do Passo 6**, com PMO específico ou em horário calmo.
- Regra ausente do cálculo da rodada (erro ao ler as pendências) é **pulada**: nada é aberto nem normalizado por engano.
- A conta de horas é de **expediente** (turnos da regra, segunda a sexta, fuso de São Paulo); sem turno cadastrado, conta relógio corrido.

## Lembretes
- **Não normalizar** o sufixo `_` das OPs (`PMOC50_`, `8504_` são válidas).
- A OP de teste e seus registros ficam no Prod: **limpar depois** (anote PMO/OP).
