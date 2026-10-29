#!/usr/bin/env bash
# Teste SQL do Dashboard e do Fluxo em placas (0164) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-placas-dashboard-fluxo-test.sh
# Aplica as definições VIGENTES reais (0090 sf_fluxo_periodo, 0093 sf_producao_periodo,
# 0105 sf_dashboard_*, 0157 sf_fluxo_op) e a 0161 (pecas + trigger), grava a massa e tira a foto
# das funções antigas, aplica a 0164 duas vezes (idempotência) e roda o teste.
# PRE=1 pula a 0164 (o teste tem de FALHAR contra as funções antigas).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-placas-dashboard-fluxo-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/placas_dashboard_fluxo_esquema.sql "$NOME":/tmp/esquema.sql
for m in 0090_sf_fluxo_periodo 0093_sf_producao_periodo 0105_sf_dashboard_filtro_clique \
         0157_sf_fluxo_op_burnin_primeira 0161_placas_por_painel 0164_placas_dashboard_fluxo; do
  docker cp "supabase/migrations/$m.sql" "$NOME":/tmp/"${m%%_*}".sql
done
docker cp supabase/tests/placas_dashboard_fluxo_massa.sql "$NOME":/tmp/massa.sql
docker cp supabase/tests/placas_dashboard_fluxo_test.sql "$NOME":/tmp/teste.sql

p() { docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f "$1"; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
p /tmp/0090.sql; p /tmp/0093.sql; p /tmp/0105.sql; p /tmp/0157.sql; p /tmp/0161.sql
p /tmp/massa.sql
if [ "${PRE:-}" != "1" ]; then p /tmp/0164.sql; p /tmp/0164.sql; fi
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -o /dev/null -f /tmp/teste.sql
echo "PLACAS DASHBOARD/FLUXO SQL OK"
