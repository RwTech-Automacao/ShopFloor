#!/usr/bin/env bash
# Teste SQL da caixa/embalagem em placas (0163) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-placas-caixa-test.sh
# Aplica a 0161 REAL (colunas + trigger de pecas), extrai a sf_fechar_caixa REAL da 0100 e aplica a
# sf_lancar REAL da 0103 (a 0103 inteira traz também sf_registrar_reparo, que depende de tabelas que
# este teste não precisa), e a 0163 duas vezes para provar idempotência.
# RED=1 pula a 0163 (roda contra as funções antigas: o teste tem de falhar).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-placas-caixa-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"; docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
sed -n '/^create or replace function public.sf_fechar_caixa/,/^\$\$;/p' supabase/migrations/0100_caixa_reprovada_revisao.sql > "$TMP/0100_fechar.sql"
sed -n '/^create or replace function public.sf_lancar/,/^\$\$;/p' supabase/migrations/0103_rota_reteste_obrigatoria.sql > "$TMP/0103_lancar.sql"

docker cp supabase/tests/placas_caixa_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0161_placas_por_painel.sql "$NOME":/tmp/0161.sql
docker cp "$TMP/0100_fechar.sql" "$NOME":/tmp/0100.sql
docker cp "$TMP/0103_lancar.sql" "$NOME":/tmp/0103.sql
docker cp supabase/migrations/0163_placas_caixa.sql "$NOME":/tmp/0163.sql
docker cp supabase/tests/placas_caixa_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0161.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0100.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0103.sql
if [ -z "${RED:-}" ]; then
  docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0163.sql
  docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0163.sql   # de novo: idempotente
fi
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
echo "PLACAS CAIXA SQL OK"
