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
P -1 -f /tmp/0184.sql
P -1 -f /tmp/0194.sql
P -1 -f /tmp/0194.sql   # idempotente
P -f /tmp/teste.sql
P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from pg_proc where proname in ('sf_ordem_regravar_trechos','sf_faixa_coerente','sf_faixas_sobrepoem')" | grep -qx 0 || { echo "rollback não removeu as funções"; exit 1; }
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from pg_proc where proname in ('sf_ordem_regravar_postos','sf_ordem_regravar_faixas')" | grep -qx 2 || { echo "rollback levou as funções da 0184"; exit 1; }
P -1 -f /tmp/0194.sql   # volta depois do rollback
echo "EDITAR OP TRECHOS SQL OK"
