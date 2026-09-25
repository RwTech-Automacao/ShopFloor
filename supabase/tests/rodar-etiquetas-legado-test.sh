#!/usr/bin/env bash
# Testes SQL das etiquetas do estoque legado (0126) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-etiquetas-legado-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-etiquetas-legado-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0126_etiquetas_legado.sql "$NOME":/tmp/0126.sql
docker cp supabase/tests/etiquetas_legado_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar a migração duas
# vezes na mesma base não pode falhar nem mudar o que já foi emitido.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0126.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','recebimento.gerar_etiqueta',false)" \
  -c "select total_etiquetas from etq_legado_resumo()" | tail -1 | grep -qx 7 \
  && echo "idempotência da 0126: ok" \
  || { echo "idempotência da 0126 FALHOU"; exit 1; }
