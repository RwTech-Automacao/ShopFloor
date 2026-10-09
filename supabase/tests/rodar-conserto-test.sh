#!/usr/bin/env bash
# Teste SQL da 0138 (origem/conserto em sf_conserto_confirmado) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-conserto-test.sh
# A 0072 só depende de tem_permissao(text) (de UM argumento, usada nas políticas): um stub mínimo
# basta. O _stubs.sql não serve aqui — só define a versão de dois argumentos.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-conserto-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0072_sf_conserto_confirmado.sql "$NOME":/tmp/0072.sql 2>/dev/null \
  || docker cp "$(ls supabase/migrations/0072_*.sql)" "$NOME":/tmp/0072.sql
docker cp supabase/migrations/0138_conserto_confirmado_origem.sql "$NOME":/tmp/0138.sql
docker cp supabase/tests/conserto_origem_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "create function public.tem_permissao(p text) returns boolean language sql stable as \$f\$ select true \$f\$"
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0072.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0138.sql
# Idempotência: reaplicar não pode falhar.
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0138.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
