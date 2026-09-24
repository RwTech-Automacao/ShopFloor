#!/usr/bin/env bash
# Testes SQL do Fluxo e dos Registros do Recebimento (0124) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-recebimento-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-recebimento-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0124_recebimento_fluxo_registros.sql "$NOME":/tmp/0124.sql
docker cp supabase/tests/recebimento_fluxo_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar a 0124 duas vezes
# na mesma base não pode falhar nem mudar o resultado.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0124.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','recebimento.visualizar',false)" \
  -c "select sum(itens) from rec_fluxo_emb('EMB390')" | tail -1 | grep -qx 7 \
  && echo "idempotência da 0124: ok" \
  || { echo "idempotência da 0124 FALHOU"; exit 1; }
