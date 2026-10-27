#!/usr/bin/env bash
# Teste SQL das placas por painel (0161) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-placas-painel-test.sh
# Aplica a 0161 duas vezes para provar idempotência.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-placas-painel-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/placas_painel_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0161_placas_por_painel.sql "$NOME":/tmp/0161.sql
docker cp supabase/tests/placas_painel_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0161.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0161.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "PLACAS PAINEL SQL OK"
