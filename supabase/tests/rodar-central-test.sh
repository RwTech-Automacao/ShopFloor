#!/usr/bin/env bash
# Teste SQL das funções da "foto" da Central do Cliente (0134) num Postgres descartável.
# Uso: supabase/tests/rodar-central-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-central-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0134_central_sincronizacao.sql "$NOME":/tmp/0134.sql
docker cp supabase/tests/central_sincronizacao_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar a migração duas
# vezes na mesma base não pode falhar (create index/function usam if not exists / or replace).
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0134.sql \
  && echo "idempotência da 0134: ok" \
  || { echo "idempotência da 0134 FALHOU"; exit 1; }
