#!/usr/bin/env bash
# Testes SQL da soma "já enviado por OP" (migração 0153) num Postgres descartável.
# Uso: supabase/tests/rodar-estoque-enviado-test.sh
# A 0132 e a 0153 são aplicadas de dentro do .sql; depois a 0153 roda mais DUAS vezes com `psql -1`
# (como no RDS), e por fim do zero numa base limpa só com o stub de permissão (as roles são do cluster
# e já existem desde o teste).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-estoque-enviado-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/migrations/0132_sf_estoque_envios.sql "$NOME":/tmp/0132.sql
docker cp supabase/migrations/0153_sf_estoque_enviado.sql "$NOME":/tmp/0153.sql
docker cp supabase/tests/estoque_enviado_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "testes da soma: ok"

docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0153.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0153.sql
V=$(docker exec -i "$NOME" psql -U postgres -qtA -c "select public.sf_estoque_enviado('PMOT01','9100')")
[ "$(tr -d '[:space:]' <<<"$V")" = "46" ] && echo "idempotência da 0153 (resultado intacto): ok" || { echo "idempotência FALHOU ($V)"; exit 1; }

docker exec "$NOME" createdb -U postgres limpo
docker exec "$NOME" psql -U postgres -d limpo -v ON_ERROR_STOP=1 -q -c \
  "create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as \$f\$ select false \$f\$"
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0153.sql
echo "0132 + 0153 do zero, em transação única: ok"
echo "ESTOQUE ENVIADO OK"
