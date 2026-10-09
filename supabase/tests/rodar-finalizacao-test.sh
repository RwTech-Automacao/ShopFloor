#!/usr/bin/env bash
# Teste SQL da 0145 (finalização automática de OP) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-finalizacao-test.sh
# Aplica a 0121 REAL (a conta de conclusão não é reinventada nem simulada) e a 0145 duas vezes.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-finalizacao-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/finalizacao_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0121_sf_ops_com_bipes_pct_conclusao.sql "$NOME":/tmp/0121.sql
docker cp supabase/migrations/0145_sf_finalizacao_automatica.sql "$NOME":/tmp/0145.sql
docker cp supabase/tests/finalizacao_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0121.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0145.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0145.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "FINALIZACAO SQL OK"
