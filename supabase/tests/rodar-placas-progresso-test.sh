#!/usr/bin/env bash
# Teste SQL do progresso da OP em placas (0162) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-placas-progresso-test.sh
# Aplica as migrações REAIS (0036, 0121, 0161, 0162 x2, 0145, 0148) sobre o esquema mínimo da finalização.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-placas-progresso-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/finalizacao_esquema.sql "$NOME":/tmp/esquema.sql
for m in 0036_sf_ordem_resumo 0121_sf_ops_com_bipes_pct_conclusao 0145_sf_finalizacao_automatica \
         0148_sf_reabertura_manual 0161_placas_por_painel 0162_placas_progresso_op; do
  docker cp "supabase/migrations/$m.sql" "$NOME":/tmp/"${m%%_*}".sql
done
docker cp supabase/tests/placas_progresso_test.sql "$NOME":/tmp/teste.sql

p() { docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f "$1"; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
p /tmp/0036.sql; p /tmp/0121.sql; p /tmp/0145.sql; p /tmp/0148.sql; p /tmp/0161.sql
# PRE=1 roda o teste antes da 0162 (deve FALHAR); padrão aplica a 0162 duas vezes (idempotência).
if [ "${PRE:-}" != "1" ]; then p /tmp/0162.sql; p /tmp/0162.sql; fi
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "PLACAS PROGRESSO SQL OK"
