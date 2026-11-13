#!/usr/bin/env bash
# Testes SQL da 0184 (estrutura da OP) num Postgres descartável. Uso: supabase/tests/rodar-estrutura-op-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-estrutura-op-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0184_estrutura_op.sql "$NOME":/tmp/0184.sql
docker cp supabase/tests/estrutura_op_prova.sql "$NOME":/tmp/prova.sql
docker cp docs/operacao/estrutura-op/rollback-0184.sql "$NOME":/tmp/rollback.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0184.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0184.sql   # idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/prova.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/rollback.sql
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from information_schema.tables where table_name in ('sf_estruturas','sf_estrutura_trechos','sf_ordem_trechos')" | grep -qx 0 || { echo "rollback não removeu as tabelas"; exit 1; }
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from sf_estoque_envios where pmo like 'PRT%' and operacao = 'entrada' and not ok and cancelado_em is null and tentativas = 0 and reservado_em is null" | grep -qx 0 || { echo "rollback deixou entrada de PRT intocada pendente na fila"; exit 1; }
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from pg_proc where proname in ('sf_trecho_chave','sf_resumo_trechos_op','sf_trecho_enfileirar','sf_trecho_desfazer','sf_salvar_estrutura')" | grep -qx 0 || { echo "rollback não removeu as funções"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0184.sql   # volta depois do rollback
echo "ESTRUTURA OP SQL OK"
