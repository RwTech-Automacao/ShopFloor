# Deploy do alerta "Parado ou travado na produção" (roteiro)

O tipo de regra `parado` (hoje "Parado no Almoxarifado", migração 0167) passa a ser **"Parado ou travado na produção"**: avisa quando **peças ficam paradas em qualquer posto** da rota por mais de X horas, sem terminar. **Uma mensagem por OP** (chave `PMO/OP`), lembrete a cada N minutos enquanto houver peça parada, normaliza sozinha. Nenhuma tela nova: é uma regra em **Alertas**, como as outras. Use sempre o último commit da `main` depois do merge da branch `feat/alerta-parado-travado`.
Tudo na **Lightsail**, um bloco de cada vez. A senha do banco é digitada no `Password:`. Nada de senha no chat.

## O que este deploy faz
- Aplica **uma** migração, a **0172** (aditiva e idempotente): duas colunas novas em `alerta_regras` (`so_ops_ativas`, `incluir_manutencao`), limite de horas de 1–72 para 1–720, a função de leitura `alerta_travados`, e `alerta_avaliar` (mesma assinatura de 4 parâmetros) com **só o bloco do parado alterado** (conferido por diff contra a 0170).
- Sobe o **aplicativo** com o tipo reescrito (formulário, mensagem, conta do corte de expediente).
- **Não remove nada do Almoxarifado**: `sf_almox_pendencias`, `sf_almox_necessidades`, `sf_almox_lotes` e as `_base` continuam (a tela do Almoxarifado usa). Só o alerta deixou de chamá-las.
- Nenhuma regra `parado` existe em Prod hoje. Se existir alguma em outro banco, a migração a **desativa uma única vez** (os postos dela são de Almoxarifado, onde a peça já terminou); o gestor reabre a regra e escolhe os postos.

## Ordem (importante)
Prod está na **0168**. Ordem do deploy combinado: **0169 → 0170 → 0171 → 0172 → app** (cada uma só depende das anteriores; o arquivo de cada uma tem o seu roteiro/ordem).
1. **Primeiro a migração, depois o aplicativo.** O app novo lê `so_ops_ativas`/`incluir_manutencao` na lista de regras e chama `alerta_travados`: o app novo **antes** da migração quebra `listarRegras` de **todos** os tipos e o cron devolve 503. O app antigo com o banco novo segue funcionando.
2. A migração é uma transação só (`-1`), com limite de espera de 5 s (`lock_timeout`). Se estourar, **nada foi gravado**: repita o comando.
3. Escolha um momento de **baixo movimento**. Recomendado: **snapshot manual do RDS** antes (as mudanças são só de funções e duas colunas de uma tabela pequena).

## Antes de começar (depois de aplicar 0169, 0170 e 0171)
Ponto de partida (**7 linhas, todas `ok = t`**):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select item, ok from (values (1, 'AINDA NAO tem alerta_regras.so_ops_ativas', not exists (select 1 from information_schema.columns where table_schema='public' and table_name='alerta_regras' and column_name='so_ops_ativas')), (2, 'EXATAMENTE UMA alerta_avaliar (4 parametros)', (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) = 1 and to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb,jsonb)') is not null), (3, 'AINDA NAO tem alerta_travados', to_regprocedure('public.alerta_travados(text[],text[],timestamptz,boolean,boolean)') is null), (4, '0170 aplicada (alerta_compels_problemas)', to_regprocedure('public.alerta_compels_problemas(text[],text[])') is not null), (5, 'sf_almox_pendencias_base (a tela do Almoxarifado)', to_regprocedure('public.sf_almox_pendencias_base()') is not null), (6, 'sf_registros.pecas (0161)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_registros' and column_name='pecas')), (7, 'sf_ordem_postos.ordem (0030)', exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_ordem_postos' and column_name='ordem'))) as t(n, item, ok) order by n;"
```
Qualquer `f`: **pare** e me mande a saída. Confirme que não há transação presa (deve vir vazio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pid, state, now() - xact_start as transacao, left(regexp_replace(query, '\s+', ' ', 'g'), 80) as consulta from pg_stat_activity where datname = 'postgres' and state = 'idle in transaction';"
```

## Passo 1: trazer os arquivos (só baixa)
```bash
cd ~/ShopFloor && git fetch origin main && for f in supabase/migrations/0172_alerta_parado_travado.sql docs/operacao/alerta-parado-travado/01-medir.sql docs/operacao/alerta-parado-travado/02-simulacao.sql; do git show origin/main:$f > /tmp/$(basename $f) || echo "FALHOU: $f"; done; wc -l /tmp/0172_alerta_parado_travado.sql /tmp/01-medir.sql /tmp/02-simulacao.sql
```
Devem aparecer os três arquivos com linhas.

## Passo 2: aplicar a migração (senha no `Password:`)
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=5s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0172_alerta_parado_travado.sql
```
Deve terminar com `NOTIFY`, sem `ERROR`. Com `lock timeout`, repita. Com qualquer outro erro, **pare** e me mande a mensagem inteira.

## Passo 3: recarregar o PostgREST e conferir
```bash
cd ~/supabase/docker && docker compose restart rest
```
```bash
docker ps --filter name=supabase-rest --format '{{.Names}} {{.Status}}'
```
Conferência (**9 linhas, todas `ok = t`**):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select item, ok from (values (1, 'colunas so_ops_ativas e incluir_manutencao (default true)', (select count(*) from information_schema.columns where table_schema='public' and table_name='alerta_regras' and column_name in ('so_ops_ativas','incluir_manutencao') and column_default = 'true') = 2), (2, 'EXATAMENTE UMA alerta_avaliar', (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) = 1), (3, 'alerta_avaliar so para service_role', not has_function_privilege('authenticated', 'public.alerta_avaliar(text,jsonb,jsonb,jsonb)', 'execute') and has_function_privilege('service_role', 'public.alerta_avaliar(text,jsonb,jsonb,jsonb)', 'execute')), (4, 'alerta_travados so para service_role', has_function_privilege('service_role', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute') and not has_function_privilege('authenticated', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute') and not has_function_privilege('anon', 'public.alerta_travados(text[],text[],timestamptz,boolean,boolean)', 'execute')), (5, 'limite_horas aceita 720', pg_get_constraintdef((select oid from pg_constraint where conname = 'alerta_regras_limite_horas_so_parado')) like '%720%'), (6, 'sf_almox_pendencias_base intacta (tela do Almoxarifado)', to_regprocedure('public.sf_almox_pendencias_base()') is not null), (7, 'sf_almox_pendencias executavel por authenticated', has_function_privilege('authenticated', 'public.sf_almox_pendencias()', 'execute')), (8, 'alerta_avaliar menciona dados.expediente', (select pg_get_functiondef(oid) like '%v_expediente%' from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace)), (9, 'nenhuma regra parado ativa por engano', not exists (select 1 from public.alerta_regras where tipo = 'parado' and ativa and excluida_em is null))) as t(n, item, ok) order by n;"
```
Qualquer `f`: **pare** e me mande a saída.

Mede o custo da leitura nova no banco real (só leitura; rode duas vezes; olhe os dois `Execution Time`). Critério: **só ativas <= 1500 ms** e **todas <= 5000 ms** (a função roda a cada 5 minutos, uma vez por regra):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/01-medir.sql | grep -E "Execution Time|Planning Time"
```
No Docker, com ~850 mil registros e **sem estatística** (o pior caso), a função levou ~0,9 s (só ativas) e ~2,2 s (todas); o script é `supabase/tests/rodar-alertas-travados-medir.sh`. Se passar de uns 3x o critério, **pare** e me mande o número.

Confira o cron com o app **ainda antigo** (a rotina normal; ele segue avaliando os demais tipos):
```bash
curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar ; echo ; tail -n 3 ~/alertas.log
```
Deve responder um JSON de resumo (sem `erro`). Se vier `Banco indisponível`/503, **pare** e me mande a resposta e o `tail`.

## Passo 4: deploy do aplicativo (reinicia o app por alguns segundos)
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
Termina com `deploy OK -> <código do último commit da main>`. Depois, o cron de novo (agora com o app **novo**):
```bash
curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar ; echo ; tail -n 3 ~/alertas.log
```
Abra **Alertas** no navegador: a lista de regras deve carregar e, em **Nova regra**, o tipo **Parado ou travado na produção** deve aparecer, com **Limite (horas)**, **Só OPs ativas** e **Incluir peças em Manutenção**.

## Passo 5: simulação ANTES de criar a regra de produção
Sem piso de idade, o primeiro ciclo de uma regra abre **uma ocorrência por OP** para tudo o que já estiver parado — e cada OP vira **um e-mail por destinatário por dia** enquanto houver peça parada. Veja o que a regra do caso de uso enxergaria agora (só leitura):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/02-simulacao.sql
```
Saem três tabelas: por OP e posto (com a idade e exemplos de SN), o resumo por OP e o total (quantas OPs = quantos e-mails por dia por pessoa). O que olhar: **muitas OPs antigas abandonadas** (o e-mail diário seria sobre elas para sempre). Antes de criar a regra: finalize/arrume a OP, marque **Só OPs ativas**, ou restrinja **Postos** e **PMOs**. Mande-me a saída se houver dúvida.

## Passo 6: a receita do caso de uso (peças paradas há mais de uma semana, e-mail seg–sex para Diogo, Bruno e Tiago)
**Pré-requisito:** os três precisam ter **usuário ativo** no ShopFloor com **e-mail** preenchido e **permissão de administrar o módulo ShopFloor** (o e-mail só sai para quem administra; é a mesma regra das outras). O SMTP dos Alertas já funciona em Prod.

Em **Alertas > Nova regra > Parado ou travado na produção**:

| Campo | Valor |
|---|---|
| Nome | `Peças paradas há mais de uma semana` |
| Postos | marque **todos** os postos da rota (ou só os que interessam) |
| Limite (horas) | `168` (a dica sob o campo mostra "168 h = 7 dias") |
| Só OPs ativas | marcado (padrão); desmarque para incluir OPs já finalizadas com peças esquecidas |
| Incluir peças em Manutenção | marcado (padrão): peças reprovadas esperando conserto também contam |
| Turnos | **vazio** (relógio corrido: sábado e domingo contam na conta da semana) |
| PMOs | vazio (todas) |
| Lembrar a cada (min) | `1440` |
| Como avisar | marque **Mensagem direta ao responsável** e, dentro dela, **E-mail**; desmarque Telegram/Discord e o canal |
| Responsáveis | Diogo, Bruno, Tiago |

Como se comporta (conferido nos testes):
- **Só avisa se houver peça parada:** sem peça, não existe ocorrência e nada sai.
- **Um e-mail por OP com peça parada**, por pessoa. O assunto é a primeira linha: `⚠️ Parado na produção: OP PMO/OP com N peças paradas (limite 168 h)`; nos dias seguintes, `⏰ Lembrete — OP PMO/OP · aberto há 3 d`. O corpo lista, por posto, quantas peças, a idade da mais antiga e até 3 números de série de exemplo.
- **Primeiro e-mail:** na primeira rodada do cron (5 em 5 minutos) de um **dia útil** depois de criada a regra, para toda OP que já tiver peça com mais de 168 h.
- **Todo dia útil depois:** o lembrete de 1440 min (24 h) repete o aviso a cada 24 h **desde o último envio**. Como cada rodada olha o relógio a cada 5 minutos, o horário pode **escorregar alguns minutos por dia** (não é um horário fixo como "08:00").
- **Sábado e domingo:** o app **pula** as regras desse tipo (calendário de São Paulo): nada abre, nada lembra, nada normaliza. Na segunda, o lembrete vence na **primeira rodada do cron do dia** (a mesma hora em que o RDS liga/o cron volta), não "às 08:00".
- **Quando a OP não tem mais peça parada:** uma mensagem `🟢 Parado na produção: OP PMO/OP sem peças paradas` e a ocorrência se encerra sozinha.
- O botão **Resolvido** não existe no e-mail. Quem usa Telegram/Discord pode apertá-lo; o alerta reabre sozinho depois da carência se a peça continuar parada.

## Passo 7: smoke guiado numa OP de TESTE (antes da regra real)
Use um PMO/OP **claramente de teste** (ex.: `PMOTESTE01` / `9901`), com a rota e pelo menos 2 peças bipadas num posto do meio. Anote para limpar depois.
1. **Criar a regra de teste**: tipo **Parado ou travado na produção**, **limite 1 h**, postos = o posto onde as peças estão, **PMO = o de teste**, só você como responsável (Telegram ou e-mail), lembrete vazio.
2. **Envelhecer** as peças para passar de 1 h sem esperar (só na OP de teste):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -c "update public.sf_registros set data_hora = data_hora - interval '3 hours' where pmo = 'PMOTESTE01' and op = '9901' returning posto, numero_serie, data_hora;"
```
3. **Ver a mensagem** em até 5 minutos num dia útil (ou dispare o `curl` do Passo 4): **uma** mensagem para a OP, com o posto, as peças e os SNs. **Alertas > Ocorrências** mostra uma ocorrência com a OP.
4. **Andar com as peças** (bipar no posto seguinte, ou até o último posto): no cron seguinte, a ocorrência **normaliza** e chega a mensagem 🟢.
5. **Limpar:** apague a regra de teste e cancele os lançamentos de teste (tela de Cancelamentos). Anote o PMO/OP.

## Rollback
Ordem: o app antigo **não tem** o formulário novo. Antes de voltar o app ou o banco, desative as regras `parado` e normalize as ocorrências vivas (uma transação, só mexe em `parado`):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -c "update public.alerta_ocorrencias oc set estado='normalizada', normalizada_em=now() from public.alerta_regras rg where rg.id=oc.regra_id and rg.tipo='parado' and oc.estado in ('aberta','resolvida'); update public.alerta_regras set ativa=false where tipo='parado';"
```
- **App:** `bash ~/rollback-janela.sh app`. O app antigo roda com o banco **novo** sem problema (a regra `parado` dele lê `sf_almox_pendencias_base`, que continua lá; regras `parado` desativadas não são lidas).
- **Banco** (só se for preciso voltar o banco): recria `alerta_avaliar` a partir da 0170 e remove `alerta_travados`. As colunas novas e o limite de 720 **ficam** (inofensivos). Gera o arquivo (só gera, não toca o banco):
```bash
cd ~/ShopFloor && git fetch origin main && { echo "update public.alerta_ocorrencias oc set estado='normalizada', normalizada_em=now() from public.alerta_regras rg where rg.id=oc.regra_id and rg.tipo='parado' and oc.estado in ('aberta','resolvida');"; echo "update public.alerta_regras set ativa=false where tipo='parado';"; echo; git show origin/main:supabase/migrations/0170_alerta_problemas_compels.sql | awk 'index($0,"create or replace function public.alerta_avaliar(")==1{p=1} p{print} p&&/^\$func\$;/{exit}'; echo; echo "drop function if exists public.alerta_travados(text[], text[], timestamptz, boolean, boolean);"; echo "revoke all on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) from public, anon, authenticated;"; echo "grant execute on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) to service_role;"; echo "notify pgrst, 'reload schema';"; } > /tmp/rollback-0172.sql && grep -c 'create or replace function' /tmp/rollback-0172.sql && wc -l /tmp/rollback-0172.sql
```
Deve imprimir `1` e o total de linhas (perto de 900). Aplique:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=5s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/rollback-0172.sql
```
```bash
cd ~/supabase/docker && docker compose restart rest
```

## Pontos conhecidos
- **Uma OP = um e-mail por pessoa por dia.** Com 20 OPs paradas são 20 e-mails por dia para cada um dos três. Não existe (ainda) um "relatório único"; para reduzir, restrinja postos/PMOs ou marque **Só OPs ativas**.
- "Peça parada" = último registro do SN (por OP) está num posto da regra e é mais antigo que o limite; **não conta** a peça que terminou (último registro no último posto da rota não é reprovação, a conta da finalização automática). Posto **Burn-in** (peça "cozinhando" por horas) também conta se estiver na regra: tire-o dos postos se não quiser aviso dele.
- OP que não está em `sf_ordens` (registro órfão) é ignorada. OP sem rota cadastrada não conclui nenhuma peça (todas as peças dela contam como paradas no último posto em que aparecem).
- A conta de horas é de **expediente** só quando a regra tem turnos (segunda a sexta, fuso de São Paulo); sem turnos é relógio corrido. Feriados contam como dia útil.
- O posto da ocorrência é o **primeiro posto marcado** na regra (fixo, para a ocorrência não trocar de posto quando a peça andar). Na tela de Ocorrências a OP aparece com esse posto; o detalhe por posto está na mensagem.
- **Não normalizar** o sufixo `_` das OPs (`PMOC50_`, `8504_` são válidas).
