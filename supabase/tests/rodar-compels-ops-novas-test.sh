#!/usr/bin/env bash
# Teste SQL da 0176 (OPs novas integram com o Compels) num Postgres descartável.
# Uso: supabase/tests/rodar-compels-ops-novas-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-compels-ops-novas-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/tests/compels_ops_novas_test.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0176_ops_novas_integram_compels.sql "$NOME":/tmp/0176.sql
docker cp supabase/tests/compels_ops_novas_prova.sql "$NOME":/tmp/prova.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
# A migração duas vezes (idempotência).
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0176.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0176.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/prova.sql
# Rollback e nova aplicação (a coluna sai e volta).
docker cp docs/operacao/compels-ops-novas/rollback-0176.sql "$NOME":/tmp/rollback.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/rollback.sql
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from information_schema.columns where table_name='sf_ordens' and column_name='integrar_compels'" | grep -qx 0 || { echo "rollback não removeu a coluna"; exit 1; }
echo "COMPELS OPS NOVAS SQL OK"
