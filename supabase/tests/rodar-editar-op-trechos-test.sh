#!/usr/bin/env bash
# Testes SQL da 0194 (edição de OP por trecho) num Postgres descartável. Uso: supabase/tests/rodar-editar-op-trechos-test.sh
# Monta o esquema mínimo da 0184 (estrutura_op_esquema.sql), a 0184 real, a sf_sn_na_faixa real da 0129 (extraída do
# arquivo) e aplica a 0194 DUAS vezes (idempotência). Depois o rollback e a 0194 de novo.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-editar-op-trechos-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
awk -v f="create or replace function public.sf_sn_na_faixa(" '
  index($0, f) == 1 { dentro = 1 }
  dentro { print }
  dentro && $0 == "end $func$;" { exit }' supabase/migrations/0129_sf_almoxarifado_entrada.sql > "$TMPD/sf_sn_na_faixa.sql"
[ -s "$TMPD/sf_sn_na_faixa.sql" ] || { echo "sf_sn_na_faixa não encontrada na 0129"; exit 1; }
docker cp "$TMPD/sf_sn_na_faixa.sql" "$NOME":/tmp/sf_sn_na_faixa.sql
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0184_estrutura_op.sql "$NOME":/tmp/0184.sql
docker cp supabase/migrations/0194_editar_op_trechos.sql "$NOME":/tmp/0194.sql
docker cp supabase/tests/editar_op_trechos_test.sql "$NOME":/tmp/teste.sql
docker cp docs/operacao/estrutura-op/rollback-0194.sql "$NOME":/tmp/rollback.sql
P() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
P -f /tmp/esquema.sql
P -f /tmp/sf_sn_na_faixa.sql
Q() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq "$@"; }
DEFS="select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) from pg_proc p where p.proname in ('sf_trecho_enfileirar','sf_trecho_desfazer','sf_ordem_regravar_postos','sf_ordem_regravar_faixas')"
P -1 -f /tmp/0184.sql
Q -c "$DEFS" > "$TMPD/defs-0184.txt"
P -1 -f /tmp/0194.sql
P -1 -f /tmp/0194.sql   # idempotente
P -f /tmp/teste.sql

# ---------- a corrida com o bipe: duas sessões de verdade ----------
P -c "select sf_cadastrar_op('{\"ordem\":{\"pmo\":\"PMOZ\",\"op\":\"9700\",\"cliente\":\"C\",\"qtd\":5},\"trechos\":[{\"seq\":1,\"codigo\":\"PRTZ\",\"tipo\":\"prt\",\"compels_op\":\"9701\",\"postos\":[\"SPI\",\"Inspeção AOI TOP\"],\"faixas\":[]},{\"seq\":2,\"codigo\":\"PMOZ\",\"tipo\":\"pmo\",\"compels_op\":\"9700\",\"postos\":[\"Teste\",\"Almoxarifado\"],\"faixas\":[{\"sn_ini\":\"1\",\"sn_fim\":\"5\"}]}]}'::jsonb)" >/dev/null
RPC="select sf_ordem_regravar_trechos((select id from sf_ordens where pmo = 'PMOZ'), '[{\"seq\":1,\"postos\":[\"Inspeção AOI TOP\",\"SPI\"]},{\"seq\":2,\"postos\":[\"Teste\",\"Almoxarifado\"],\"faixas\":[{\"sn_ini\":\"1\",\"sn_fim\":\"5\"}]}]'::jsonb, '{\"cliente\":\"C\",\"placas_por_painel\":1}'::jsonb, '[]'::jsonb, '[]'::jsonb)"
BIPE() { echo "insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMOZ', '9700', 'Aprovado', '$1', '$1')"; }
espera() { # roda $1 numa sessão que segura a transação por 4 s
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "begin" -c "$1" -c "select pg_sleep(4)" -c "commit" >/dev/null 2>&1 &
  sleep 1.5
}
# 1) a edição segurando a OP: o bipe (trigger) espera
espera "$RPC"
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '700ms'" -c "$(BIPE 1)" >/dev/null 2>"$TMPD/e1"; then echo "bipe não esperou a edição da OP"; exit 1; fi
grep -q "lock timeout" "$TMPD/e1" || { cat "$TMPD/e1"; exit 1; }
wait
# 2) bipe segurando a OP: a edição espera (KEY SHARE x FOR UPDATE)
espera "$(BIPE 2)"
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '700ms'" -c "$RPC" >/dev/null 2>"$TMPD/e2"; then echo "edição não esperou o bipe"; exit 1; fi
grep -q "lock timeout" "$TMPD/e2" || { cat "$TMPD/e2"; exit 1; }
# 3) bipe contra bipe não se bloqueia (mesma OP, outra peça)
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "set lock_timeout = '700ms'" -c "$(BIPE 3)" >/dev/null || { echo "bipe travou outro bipe"; exit 1; }
wait
# 4) o advisory do sf_lancar segurado: a edição espera
espera "select pg_advisory_xact_lock(hashtext('PMOZ' || '/' || '9700')::bigint)"
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '700ms'" -c "$RPC" >/dev/null 2>"$TMPD/e4"; then echo "edição não pegou o advisory da OP"; exit 1; fi
grep -q "lock timeout" "$TMPD/e4" || { cat "$TMPD/e4"; exit 1; }
wait
# 5) e a sf_ordem_regravar_postos também espera o bipe
espera "$(BIPE 4)"
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '700ms'" -c "select sf_ordem_regravar_postos((select id from sf_ordens where pmo = 'PMOZ'), array['SPI','Inspeção AOI TOP','Teste','Almoxarifado'])" >/dev/null 2>"$TMPD/e5"; then echo "regravar_postos não esperou o bipe"; exit 1; fi
grep -q "lock timeout" "$TMPD/e5" || { cat "$TMPD/e5"; exit 1; }
wait
echo "CORRIDA OK"

P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "select count(*) from pg_proc where proname in ('sf_ordem_regravar_trechos','sf_faixa_coerente','sf_faixas_sobrepoem')" | grep -qx 0 || { echo "rollback não removeu as funções"; exit 1; }
Q -c "$DEFS" > "$TMPD/defs-rollback.txt"
diff "$TMPD/defs-0184.txt" "$TMPD/defs-rollback.txt" || { echo "rollback não devolveu as funções da 0184"; exit 1; }
P -1 -f /tmp/0194.sql   # volta depois do rollback
echo "EDITAR OP TRECHOS SQL OK"
