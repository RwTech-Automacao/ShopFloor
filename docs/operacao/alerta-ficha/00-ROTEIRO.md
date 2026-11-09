# Deploy da "Ficha de apontamento" no Discord (roteiro)

Novo tipo de regra em **Alertas**: **Ficha de apontamento (Almoxarifado)**. Quando uma **caixa** ou um **lote** vira entrada pendente no Almoxarifado (aparece na lista de confirmação), sai **uma mensagem por caixa/lote** com a ficha (Data de produção, Produto, Quantidade da OP, PMO, OP, Quantidade apontada, Responsável). No **Discord** a mensagem leva o **QR do código** que o Almoxarifado bipa, anexado como imagem; Telegram e e-mail mandam só o texto. Peça avulsa **não** gera ficha. Nenhuma tela nova. Use sempre o último commit da `main` depois do merge da branch `feat/ficha-apontamento`.
Tudo na **Lightsail**, um bloco de cada vez. A senha do banco é digitada no `Password:`. Nada de senha no chat.

## O que este deploy faz
- Aplica **uma** migração, a **0173** (aditiva e idempotente): tipo de regra `ficha`, tipo de envio `ficha`, tabela de "já avisei" `alerta_ficha_avisadas`, as funções de leitura `alerta_ficha_novas` e `alerta_ficha_responsavel`, e `alerta_avaliar` (mesma assinatura de 4 parâmetros) com **só acréscimos** sobre a 0172 (conferido por `diff`: 0 linhas removidas ou alteradas).
- Sobe o **aplicativo** com o tipo novo (formulário, texto da ficha, QR anexado no Discord).
- Não cria regra nenhuma: a ficha só sai depois de alguém criar a regra (Passo 6).

## Ordem (importante)
Ordem do deploy combinado: **… 0172 → 0173 → app** (a 0173 parte do corpo da `alerta_avaliar` da 0172; sem a 0172 ela desfaria o "Parado ou travado").
1. **Primeiro a migração, depois o aplicativo.** O app novo grava o tipo `ficha`; sem a migração a regra não salva. O app **antigo** com o banco novo segue funcionando (não existe regra `ficha` até alguém criar).
2. A migração é uma transação só (`-1`), com limite de espera de 5 s (`lock_timeout`). Se estourar, **nada foi gravado**: repita o comando.
3. Baixo movimento; **snapshot manual do RDS** antes é o recomendado (a migração só mexe em funções, checks e uma tabela nova).

## Antes de começar
Ponto de partida (**8 linhas, todas `ok = t`**):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select item, ok from (values (1, 'AINDA NAO tem alerta_ficha_novas', to_regprocedure('public.alerta_ficha_novas(uuid,text[],timestamptz,integer)') is null), (2, 'EXATAMENTE UMA alerta_avaliar (4 parametros)', (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) = 1 and to_regprocedure('public.alerta_avaliar(text,jsonb,jsonb,jsonb)') is not null), (3, '0172 aplicada (alerta_travados)', to_regprocedure('public.alerta_travados(text[],text[],timestamptz,boolean,boolean)') is not null), (4, '0167 aplicada (sf_almox_necessidades_base)', to_regprocedure('public.sf_almox_necessidades_base(text,text)') is not null), (5, '0167 aplicada (sf_almox_lotes_base)', to_regprocedure('public.sf_almox_lotes_base(text,text)') is not null), (6, 'sf_caixas.fechada_em', exists (select 1 from information_schema.columns where table_schema='public' and table_name='sf_caixas' and column_name='fechada_em')), (7, 'sf_registros.nqa_lote_id e colaborador', (select count(*) from information_schema.columns where table_schema='public' and table_name='sf_registros' and column_name in ('nqa_lote_id','colaborador')) = 2), (8, 'sf_ordens.descricao e qtd', (select count(*) from information_schema.columns where table_schema='public' and table_name='sf_ordens' and column_name in ('descricao','qtd')) = 2)) as t(n, item, ok) order by n;"
```
Qualquer `f`: **pare** e me mande a saída. Confirme que não há transação presa (deve vir vazio):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pid, state, now() - xact_start as transacao, left(regexp_replace(query, '\s+', ' ', 'g'), 80) as consulta from pg_stat_activity where datname = 'postgres' and state = 'idle in transaction';"
```

## Passo 1: trazer os arquivos (só baixa)
```bash
cd ~/ShopFloor && git fetch origin main && for f in supabase/migrations/0173_alerta_ficha_apontamento.sql docs/operacao/alerta-ficha/01-medir.sql docs/operacao/alerta-ficha/02-simulacao.sql; do git show origin/main:$f > /tmp/$(basename $f) || echo "FALHOU: $f"; done; wc -l /tmp/0173_alerta_ficha_apontamento.sql /tmp/01-medir.sql /tmp/02-simulacao.sql
```
Devem aparecer os três arquivos com linhas.

## Passo 2: aplicar a migração (senha no `Password:`)
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=5s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/0173_alerta_ficha_apontamento.sql
```
Deve terminar com `NOTIFY`, sem `ERROR`. Com `lock timeout`, repita. Com qualquer outro erro, **pare** e me mande a mensagem inteira.

## Passo 3: recarregar o PostgREST e conferir
```bash
cd ~/supabase/docker && docker compose restart rest
```
```bash
docker ps --filter name=supabase-rest --format '{{.Names}} {{.Status}}'
```
Conferência (**8 linhas, todas `ok = t`**):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select item, ok from (values (1, 'EXATAMENTE UMA alerta_avaliar', (select count(*) from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace) = 1), (2, 'alerta_avaliar so para service_role', not has_function_privilege('authenticated', 'public.alerta_avaliar(text,jsonb,jsonb,jsonb)', 'execute') and has_function_privilege('service_role', 'public.alerta_avaliar(text,jsonb,jsonb,jsonb)', 'execute')), (3, 'alerta_ficha_novas so para service_role', has_function_privilege('service_role', 'public.alerta_ficha_novas(uuid,text[],timestamptz,integer)', 'execute') and not has_function_privilege('authenticated', 'public.alerta_ficha_novas(uuid,text[],timestamptz,integer)', 'execute') and not has_function_privilege('anon', 'public.alerta_ficha_novas(uuid,text[],timestamptz,integer)', 'execute')), (4, 'alerta_ficha_responsavel so para service_role', has_function_privilege('service_role', 'public.alerta_ficha_responsavel(text,text,text,text)', 'execute') and not has_function_privilege('authenticated', 'public.alerta_ficha_responsavel(text,text,text,text)', 'execute') and not has_function_privilege('anon', 'public.alerta_ficha_responsavel(text,text,text,text)', 'execute')), (5, 'tabela alerta_ficha_avisadas com RLS e sem acesso anon', (select relrowsecurity from pg_class where oid = 'public.alerta_ficha_avisadas'::regclass) and not has_table_privilege('anon', 'public.alerta_ficha_avisadas', 'select')), (6, 'tipo de regra ficha aceito', pg_get_constraintdef((select oid from pg_constraint where conname = 'alerta_regras_tipo_valido')) like '%ficha%'), (7, 'tipo de envio ficha aceito', pg_get_constraintdef((select oid from pg_constraint where conname = 'alerta_envios_tipo_check')) like '%ficha%'), (8, 'alerta_avaliar menciona a ficha', (select pg_get_functiondef(oid) like '%alerta_ficha_novas%' and pg_get_functiondef(oid) like '%v_expediente%' from pg_proc where proname = 'alerta_avaliar' and pronamespace = 'public'::regnamespace))) as t(n, item, ok) order by n;"
```
(A linha 8 também prova que o "Parado ou travado" da 0172 continua lá.) Qualquer `f`: **pare** e me mande a saída.

Mede o custo da leitura nova no banco real (só leitura; rode duas vezes; olhe os dois `Execution Time`). Critério: **<= 1500 ms** nas duas medidas (a função roda a cada 5 minutos, uma vez por regra; no Docker, com ~840 mil registros e **sem estatística**, levou 0,3-0,4 s no dia normal e ~0,9 s no pior caso):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/01-medir.sql | grep -E "Execution Time|Planning Time"
```
Se passar de uns 3x o critério, **pare** e me mande o número.

Confira o cron com o app **ainda antigo** (a rotina normal):
```bash
curl -fsS -m 60 -X POST -H @$HOME/.alertas-cron-header http://127.0.0.1:3000/api/alertas/avaliar ; echo ; tail -n 3 ~/alertas.log
```
Deve responder um JSON de resumo (sem `erro`). Se vier `Banco indisponível`/503, **pare** e me mande a resposta e o `tail`.

## Passo 4: deploy do aplicativo (reinicia o app por alguns segundos)
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
Termina com `deploy OK -> <código do último commit da main>`. Depois o cron de novo (agora com o app **novo**), o mesmo comando do Passo 3. Abra **Alertas** (**Ajustes ShopFloor > Alertas**): a lista de regras deve carregar e, em **Nova regra**, o cartão **Ficha de apontamento (Almoxarifado)** deve aparecer.

## Passo 5: simulação (só leitura)
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PAGER=cat PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -f /tmp/02-simulacao.sql
```
Saem três tabelas: as fichas que estão **pendentes agora** (com os campos exatos da mensagem), o resumo por OP e quem aparece como **responsável**. ⚠️ **Uma regra criada agora não manda nenhuma dessas** (o piso é o momento da criação da regra: ligar a regra não despeja o passado); a tabela serve para **conferir os campos e o responsável contra a tela do Almoxarifado** ("fechada em … por …") e para ter ideia do volume. Mande-me a saída se algo parecer errado (principalmente a coluna `responsavel`).

## Passo 6: a receita da regra (ficha no Discord)
**Pré-requisitos:** o canal do Discord do sistema já está configurado em Prod (as outras regras o usam). Quem for **receber por mensagem direta** precisa de **usuário ativo**, **conta do canal vinculada** (Meu perfil) e **permissão de administrar o ShopFloor**; para o **canal do Discord** basta ter ao menos **1 responsável** na regra (é exigido, como nas outras).

Em **Alertas > Nova regra > Ficha de apontamento (Almoxarifado)**:

| Campo | Valor |
|---|---|
| Nome | `Ficha do Almoxarifado` |
| PMOs | vazio (todas) — ou marque só as PMOs que devem gerar ficha |
| Como avisar | marque **No canal do Discord** (a ficha com o QR vai para o canal). Se quiser também a mensagem direta, marque **Mensagem direta ao responsável** e o canal (Discord = texto + QR; Telegram/E-mail = só texto) |
| Responsáveis | pelo menos 1 pessoa (obrigatório; quem receberia a mensagem direta) |

Não há posto, janela, limite, turno nem lembrete: o formulário não mostra esses campos.

Como se comporta (conferido nos testes SQL):
- **Uma mensagem por caixa/lote**, a cada 5 minutos (cron), no máximo **30 por rodada** (as mais antigas primeiro; o resto sai na rodada seguinte).
- **Só caixa e lote.** Peça avulsa (OP individual sem lote do NQA) **não** gera ficha. Só OP **não finalizada** que tenha o posto Almoxarifado na rota.
- **Piso e teto:** só avisa o que fechou/foi aprovado **depois de a regra ser criada** e há **no máximo 3 dias**. Mais velho que isso não avisa e nem é marcado.
- **Uma vez só:** a marca de "já avisei" (`alerta_ficha_avisadas`) impede repetir, **inclusive** se a caixa for confirmada e depois cancelada (voltar à lista).
- **Confirmada antes do cron:** se o Almoxarifado confirma a caixa em menos de 5 minutos, ela já saiu da lista e **não gera ficha**.
- **Sem ninguém alcançável** (responsável sem conta vinculada, canal sem configurar): nada é enfileirado e **a marca não grava**; a ficha sai quando houver alguém, se ainda estiver dentro dos 3 dias.
- **Assunto do e-mail** = a primeira linha: `📋 Ficha de apontamento · OP PMO/OP · Caixa CX[…]`.
- **Responsável** (ver "Pontos conhecidos"): caixa = quem deu o último bipe da caixa no posto onde ela foi fechada (o mesmo "fechada por …" da tela); lote = quem registrou por último o lote no NQA.

## Passo 7: como testar (antes de usar de verdade)
1. **Canal e texto:** em **Meu perfil > Alertas**, o botão **Enviar teste** manda uma mensagem de teste ao **seu** canal (Telegram, Discord ou e-mail). Isso prova só o encanamento do canal — **não** a ficha nem o QR.
2. **A ficha de verdade, numa OP de TESTE** (ex.: `PMOTESTE01` / `9901`, com a rota até o Almoxarifado):
   - crie a regra de teste com **PMOs = só a de teste** e **só você** como responsável (ou só o canal);
   - na **Embalagem** da OP de teste, **feche uma caixa** (ou, numa OP individual, aprove um lote no NQA); ela aparece na lista do Almoxarifado;
   - em até 5 minutos chega **uma** mensagem com os campos e o **QR** (no Discord);
   - **confira** os campos contra a tela do Almoxarifado (**Responsável** = "fechada por …"; quantidade; data) e **leia o QR com o celular**: deve mostrar `CX[…]…` (caixa) ou `LOTE[…][N]` (lote) — o mesmo código que o leitor bipa. Opcional: bipe o código no campo do Almoxarifado para ver que ele casa com a caixa;
   - espere mais 10 minutos: **nenhuma segunda mensagem** da mesma caixa.
3. **Limpar:** cancele o lançamento de teste (tela de Cancelamentos) e **desative ou apague a regra de teste**. Anote o PMO/OP.

## Rollback
O app antigo **não tem** o formulário novo, mas roda com o banco novo (regra `ficha` que existir é ignorada por ele). Antes de voltar o app ou o banco, **desative as regras** `ficha` (uma transação, só mexe em `ficha`; não há ocorrência a normalizar):
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -c "update public.alerta_regras set ativa = false where tipo = 'ficha'; update public.alerta_envios set tentativas = 3 where tipo = 'ficha' and not ok;"
```
(A segunda instrução tira da fila as fichas ainda pendentes, para o app antigo não tentar entregar um tipo que ele não conhece.)
- **App:** `bash ~/rollback-janela.sh app`.
- **Banco** (só se for preciso voltar o banco): recria `alerta_avaliar` a partir da **0172** e remove as duas funções novas. A tabela `alerta_ficha_avisadas` e os checks alargados **ficam** (inofensivos). Gera o arquivo (só gera, não toca o banco):
```bash
cd ~/ShopFloor && git fetch origin main && { echo "update public.alerta_regras set ativa = false where tipo = 'ficha';"; echo; git show origin/main:supabase/migrations/0172_alerta_parado_travado.sql | awk 'index($0,"create or replace function public.alerta_avaliar(")==1{p=1} p{print} p&&/^\$func\$;/{exit}'; echo; echo "drop function if exists public.alerta_ficha_novas(uuid, text[], timestamptz, int);"; echo "drop function if exists public.alerta_ficha_responsavel(text, text, text, text);"; echo "revoke all on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) from public, anon, authenticated;"; echo "grant execute on function public.alerta_avaliar(text, jsonb, jsonb, jsonb) to service_role;"; echo "notify pgrst, 'reload schema';"; } > /tmp/rollback-0173.sql && grep -c 'create or replace function' /tmp/rollback-0173.sql && wc -l /tmp/rollback-0173.sql
```
Deve imprimir `1` e o total de linhas (perto de 900). Aplique:
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"') && test -n "$HOST" && PGOPTIONS='-c lock_timeout=5s' PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -v ON_ERROR_STOP=1 -1 -f /tmp/rollback-0173.sql
```
```bash
cd ~/supabase/docker && docker compose restart rest
```

## Pontos conhecidos
- **"Responsável" é uma decisão a confirmar.** Está isolada em **uma função SQL pequena** (`public.alerta_ficha_responsavel`, seção D da 0173): caixa = `colaborador` do último bipe (`data_hora desc, created_at desc`) da caixa no posto onde ela foi fechada — **exatamente** a origem do "fechada em … por …" da tela (`sf_almox_detalhe`); lote = `colaborador` do último registro de NQA do lote (o mesmo que fixa a data de aprovação). Sem registro ou com nome em branco, a ficha mostra "—". Trocar a regra = trocar só o corpo dessa função (migração nova, `create or replace`).
- **Data de produção do lote** = a aprovação no NQA (`aprovado_em` = o último registro do lote). **Da caixa** = quando foi fechada (`sf_caixas.fechada_em`).
- **Quantidade apontada** = placas da caixa/lote (a mesma coluna "peças" da lista do Almoxarifado, já com placas por painel). **Quantidade da OP** = `sf_ordens.qtd`. **Produto** = `sf_ordens.descricao`.
- **Só o Discord anexa o QR.** Telegram e e-mail recebem o texto, que traz o código (`CX[…]`/`LOTE[…][N]`) por escrito na primeira linha.
- Caixa **fechada com `fechada_em` nulo** (dado muito antigo) não gera ficha. OP **sem Almoxarifado na rota** não gera.
- Uma caixa que o Almoxarifado confirma **antes** de o cron passar (< 5 min) não gera ficha: já saiu da lista. Se for importante, o caminho é gerar a ficha na hora do fechamento (fora do escopo desta entrega).
- **Não normalizar** o sufixo `_` das OPs (`PMOC50_`, `8504_` são válidas).
