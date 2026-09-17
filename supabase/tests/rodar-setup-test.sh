#!/usr/bin/env bash
# Testes SQL do módulo Setup num Postgres descartável (Docker). Uso: supabase/tests/rodar-setup-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-setup-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0111_setup_tabelas.sql "$NOME":/tmp/0111.sql
docker cp supabase/migrations/0112_setup_funcoes.sql "$NOME":/tmp/0112.sql
docker cp supabase/tests/setup_st_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Concorrência: duas sessões incluem o MESMO rolo em posições diferentes; só uma pode vencer.
docker exec "$NOME" psql -U postgres -q -c "select set_config('teste.uid','00000000-0000-0000-0000-000000000001',false)" >/dev/null
SID=$(docker exec "$NOME" psql -U postgres -tAq -c "select id from st_setups where op='9002' and face='TOP'")
for p in 50 51; do
  docker exec "$NOME" psql -U postgres -q -c "select set_config('teste.uid','00000000-0000-0000-0000-000000000001',false), set_config('teste.perms','setup.lancar,setup.administrar',false); select st_incluir_item('$SID','$p','F$p','CAPJ41-CONCORRENTE');" >/dev/null 2>&1 &
done
wait
N=$(docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from st_setup_itens where rolo='CAPJ41-CONCORRENTE'")
[ "$N" = "1" ] && echo "CONCORRÊNCIA OK" || { echo "CONCORRÊNCIA FALHOU: $N"; exit 1; }
