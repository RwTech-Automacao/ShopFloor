# Deploy do lote de 06/11/2026 (migrações 0169, 0170, 0171, 0172, 0173 e 0175) — roteiro único

Branch de release: `release/lote-2026-11-06` (integração de TODAS as branches abaixo, testada junta).
A produção já está na 0174 (rota de retorno da manutenção) e no app `141fd6c`.

| Migração | Funcionalidade | Roteiro detalhado |
|---|---|---|
| 0169 | Apontado diferente do esperado: grava e avisa (coluna `sf_estoque_envios.aviso`) | — (sem roteiro próprio) |
| 0170 | Alerta "Problemas no envio ao Compels" | — (ver abaixo, passo 7) |
| 0171 | EMB e PO no diálogo de divergência (`rec_fluxo_emb_itens`) | — |
| 0172 | Regra "Parado ou travado na produção" | `docs/operacao/alerta-parado-travado/00-ROTEIRO.md` |
| 0173 | Ficha de apontamento no Discord | `docs/operacao/alerta-ficha/00-ROTEIRO.md` |
| 0175 | Escolha de estoque PA × EINTER (dormente) | `docs/operacao/estoque-destino/00-ROTEIRO.md` |

## Regra de ouro
**Migrações ANTES do app.** O app novo antes delas derruba a listagem de regras de alerta (o cron devolve 503).
Por isso a ordem é sempre: backup → migrações → conferência → deploy do app → configuração.
E `deploy/aws/deploy.sh` só faz build se o `git pull` avançar: **não rode `git pull` à mão antes**.
Os arquivos das migrações vêm com `git show origin/main:...` (só baixa).

## 0. Antes (fora do horário de pico, com uma janela de ~30 min)
1. Tirar o **snapshot do RDS** (console da AWS) e anotar o horário.
2. No servidor, guardar os pontos de volta (cole um comando por vez):

```bash
cd ~/ShopFloor && git rev-parse HEAD > ~/antes-lote-06-11.txt && cat ~/antes-lote-06-11.txt
```
O esperado é `141fd6c8…`.

```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"'); PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W -At "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select pg_get_functiondef(p.oid) || ';' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('alerta_avaliar','sf_almoxarifado_entrada','sf_almoxarifado_lote','sf_registrar_reparo') order by p.proname, p.oid" > ~/rollback-lote-funcoes.sql; wc -l ~/rollback-lote-funcoes.sql
```
O esperado é mais de 1.500 linhas (quatro funções). Rollback fino: ver o "Rollback" de cada roteiro detalhado e `docs/operacao/estoque-destino/rollback-0175.sql`.

## 1. Trazer os arquivos das migrações (só baixa; o app não muda)
Depois que a release entrar na `main` e for enviada (`git push`), no servidor:

```bash
cd ~/ShopFloor && git fetch -q origin main && mkdir -p ~/lote && for n in 0169 0170 0171 0172 0173 0175; do f=$(git ls-tree --name-only origin/main supabase/migrations/ | grep "supabase/migrations/${n}_" | head -1); git show "origin/main:$f" > ~/lote/$(basename "$f"); done; ls -l ~/lote; git log --oneline -1 origin/main
```
Tem que listar **6 arquivos** e mostrar o commit da release.

## 2. Aplicar as 6 migrações de uma vez, numa transação só (tudo ou nada)
```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"'); PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null PGOPTIONS='-c lock_timeout=5s' psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -1 -v ON_ERROR_STOP=1 -f ~/lote/0169_sf_estoque_envios_aviso.sql -f ~/lote/0170_alerta_problemas_compels.sql -f ~/lote/0171_rec_fluxo_itens_pedido.sql -f ~/lote/0172_alerta_parado_travado.sql -f ~/lote/0173_alerta_ficha_apontamento.sql -f ~/lote/0175_estoque_destino_almoxarifado.sql
```
Se QUALQUER uma falhar, **nada** é aplicado: cole o erro e pare. O fim da saída tem `NOTIFY`, sem `ERROR`.
Se o `lock_timeout` estourar (algo segurando uma tabela), repita em outro momento.

## 3. Recarregar o PostgREST e conferir
```bash
cd ~/supabase/docker && docker compose restart rest && docker compose ps rest
```
Depois, conferir que as peças chegaram (cada linha deve ser `t`). Os detalhes e as consultas de cada funcionalidade estão
no "Passo 3" de `alerta-parado-travado`, `alerta-ficha` e `estoque-destino`. Conferência mínima:

```bash
HOST=$(grep -E '^POSTGRES_HOST=' ~/supabase/docker/.env | cut -d= -f2- | tr -d '"'); PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "host=$HOST port=5432 user=postgres dbname=postgres sslmode=require" -c "select (select count(*) from information_schema.columns where table_name='sf_estoque_envios' and column_name in ('aviso','erro_esperado','estoque')) = 3 as colunas_da_fila, to_regclass('public.alerta_compels_avisados') is not null as tabela_compels, to_regclass('public.alerta_ficha_avisadas') is not null as tabela_ficha, exists (select 1 from pg_proc where proname='alerta_travados') as funcao_travados, exists (select 1 from pg_proc where proname='sf_estoque_ultimo_da_op') as funcao_estoque, (select count(*) from pg_proc where proname='alerta_avaliar') = 1 as uma_alerta_avaliar"
```
Todas as colunas do resultado devem ser `t`.

## 3b. Alertas visíveis para todos (pedido de 06/11/2026) — ANTES do deploy do app
Hoje a tela de Alertas do Recebimento (onde está o "Fim de EMB") pode estar liberada só para o seu e-mail. As duas travas:
`ALERTAS_LIBERADO_PARA` (Alertas do ShopFloor) e `ALERTAS_RECEBIMENTO_LIBERADO_PARA` (Alertas do Recebimento).
Com `*`, todo usuário com a permissão de administrar o módulo passa a ver a tela. O `deploy.sh` do passo 4 já reinicia o app,
então basta ajustar o arquivo antes dele (um comando por vez):

```bash
cd ~/ShopFloor && grep -E '^ALERTAS_' .env.production
```
```bash
cd ~/ShopFloor && cp .env.production ~/env.production.bak-06-11 && for v in ALERTAS_LIBERADO_PARA ALERTAS_RECEBIMENTO_LIBERADO_PARA; do if grep -q "^$v=" .env.production; then sed -i "s|^$v=.*|$v=*|" .env.production; else echo "$v=*" >> .env.production; fi; done; grep -E '^ALERTAS_' .env.production
```
O esperado é as duas linhas com `=*`. A cópia fica em `~/env.production.bak-06-11` (para voltar: `cp ~/env.production.bak-06-11 ~/ShopFloor/.env.production`).

## 4. Deploy do app
```bash
cd ~/ShopFloor && bash deploy/aws/deploy.sh
```
O fim da saída é `deploy OK -> <sha da release>`. Se o build falhar, o app antigo segue no ar (o script para antes do restart).
Depois, **Ctrl+Shift+R** nas telas abertas.

## 5. Teste do cron e das telas (5 min)
- Esperar uma rodada do cron de alertas (5 min) e ver que não deu 503 (tela **Alertas** abre e lista as regras).
- Almoxarifado: abrir uma caixa (a tela abre; **não** aparece escolha de estoque enquanto o EINTER não estiver configurado).
- Recebimento: abrir o diálogo de divergência (grade e Fluxo) e ver "Nº da EMB" e "Nº da PO".

## 6. Rollback
- **App:** `git reset --hard $(cat ~/antes-lote-06-11.txt)` + `npm run build` + `pm2 restart shopfloor --update-env` + `pm2 save` (o comando completo está no fim de `docs/operacao/estoque-destino/00-ROTEIRO.md`).
- **Banco:** por funcionalidade (cada roteiro tem o seu "Rollback"; o da 0175 é `docs/operacao/estoque-destino/rollback-0175.sql`); as funções de antes estão em `~/rollback-lote-funcoes.sql`. O último recurso é o snapshot do RDS.
- Nada disso desfaz o que as regras de alerta já enviaram. Por isso **crie as regras só depois do teste do passo 5**.

## 7. Configuração depois do deploy (nenhuma regra é criada automaticamente)
1. **Problemas do Compels (0170):** Alertas > Nova regra > "Problemas no envio ao Compels", destinatário o Valdei (conta vinculada), canal à escolha.
2. **Parado ou travado (0172):** rodar `02-simulacao.sql` ANTES; fazer o smoke na OP de teste; depois a receita da semana (168 h, e-mail, seg–sex, Diogo/Bruno/Tiago): `docs/operacao/alerta-parado-travado/00-ROTEIRO.md`, passos 5 a 7.
3. **Ficha (0173):** `docs/operacao/alerta-ficha/00-ROTEIRO.md`, passos 5 a 7 (simulação, receita da regra no Discord, teste com uma caixa de OP de teste).
4. **EINTER (0175):** só depois do `.har`: as duas variáveis `COMPELS_ESTOQUE_EINTER_ID` e `COMPELS_LOCACAO_EINTER_ID` (passo 3 de `estoque-destino`).

## O que NÃO entra neste lote
`feat/ajustar-limite-caixa` (precisa renumerar a migração), `feat/card-unico-almoxarifado` e `feat/sincronizacao-central` (standby).
