# Faixas de Nº de Série por OP (0181) — roteiro de deploy

Branch `feat/faixas-sn-op`. Uma OP passa a ter N faixas de SN; o SN vale se cair em qualquer uma.
A soma das faixas tem que bater com a quantidade e as faixas não podem se sobrepor. Na edição, mexer nas
faixas (ou no PMO/OP) de uma OP com registros mostra "N registros ficariam fora das faixas novas. Salvar
mesmo assim?".

## O que vai junto

- Migração `supabase/migrations/0181_sf_ordem_faixas.sql`: tabela `sf_ordem_faixas` + backfill (1 faixa
  por OP), trigger que mantém a faixa 1 igual a `sf_ordens.sn_ini/sn_fim`, `sf_sn_nas_faixas`,
  `sf_faixas_texto`, `sf_ordem_sns_fora_das_faixas`, e a troca da checagem de faixa em
  `sf_almoxarifado_entrada` (vigente: 0175), `st_liberar_setup` e `st_trocar_rolo` (vigentes: 0112).
- App: cadastro de OP, Lançamento, Integração, Pesquisa (grade), Fluxo (não iniciadas).

`sf_ordens.sn_ini/sn_fim` continuam existindo e valem a **primeira** faixa.

## Ordem

1. **Migração ANTES do app** (o app novo lê `sf_ordem_faixas`; o app antigo funciona com a 0181).
   Conferir antes que o banco está na 0180 e que nenhuma migração depois da 0175 recriou
   `sf_almoxarifado_entrada`:
   ```sql
   select count(*) from pg_proc where proname = 'sf_almoxarifado_entrada';   -- 1
   ```
   Aplicar (Dev, depois Prod/RDS):
   ```bash
   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0181_sf_ordem_faixas.sql
   ```
   Conferir:
   ```sql
   select count(*) from sf_ordens where btrim(sn_ini) <> '' and btrim(sn_fim) <> '';  -- igual a ↓
   select count(distinct ordem_id) from sf_ordem_faixas;
   ```
2. Deploy do app.
3. Smoke: editar uma OP de teste, "Adicionar faixa", salvar (soma = quantidade); bipar no Lançamento um
   SN da faixa 2 (aceita) e um fora das duas (recusa); mudar a faixa de uma OP com registros e ver a
   pergunta; na lista de OPs, a faixa aparece como "ini–fim +1".

## Caso real (OP 8682_F)

Depois do deploy, editar a 8682_F: faixa 1 `0845801001`–`0845801993`, faixa 2 `08458001024`–`08458001030`
(qtd 1000). Conferir antes as faixas reais com o usuário (a 8682_F teve outras etiquetas tortas).

## Rollback

1. Voltar o app para a versão anterior.
2. `psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f docs/operacao/faixas-sn-op/rollback-0181.sql`
   — devolve as três funções aos corpos de antes, tira triggers e funções novas. A tabela
   `sf_ordem_faixas` **fica** (com os dados); reaplicar a 0181 volta tudo.
   ⚠️ Depois do rollback, OP com mais de uma faixa só aceita a primeira.

## Testes

- `supabase/tests/rodar-faixas-sn-test.sh` — tabela, backfill, trigger, RLS, aviso da edição, Setup com
  duas faixas, diff das funções copiadas, rollback e reaplicação.
- `PLACAS=1 supabase/tests/rodar-almoxarifado-test.sh` — entrada do Almoxarifado com duas faixas, por cima
  da 0175 (no fim da suíte).
