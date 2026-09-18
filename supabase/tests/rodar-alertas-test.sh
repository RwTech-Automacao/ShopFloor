#!/usr/bin/env bash
# Testes SQL dos alertas num Postgres descartável (Docker). Uso: supabase/tests/rodar-alertas-test.sh
#
# A 0113 é aplicada com `psql -1 -v ON_ERROR_STOP=1 -f`, exatamente como roda no RDS — assim o
# teste também garante que a migração passa inteira como transação única. A 0114 usa `create index
# concurrently`, que não roda dentro de transação nenhuma (nem com -1), então vai à parte, sem -1.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-alertas-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/_stubs.sql "$NOME":/tmp/_stubs.sql
docker cp supabase/migrations/0113_alertas.sql "$NOME":/tmp/0113.sql
docker cp supabase/migrations/0114_sf_registros_posto_data_idx.sql "$NOME":/tmp/0114.sql
docker cp supabase/tests/alertas_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/_stubs.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0113.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0114.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "ALERTAS SQL OK"
