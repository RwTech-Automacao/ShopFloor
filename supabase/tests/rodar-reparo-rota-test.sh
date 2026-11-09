#!/usr/bin/env bash
# Teste SQL da 0174 (rota de retorno da manutenção respeita a rota da OP) num Postgres descartável.
# Uso: supabase/tests/rodar-reparo-rota-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-reparo-rota-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/tests/reparo_rota_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/migrations/0174_reparo_rota_da_op.sql "$NOME":/tmp/0174.sql
docker cp supabase/tests/reparo_rota_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema.sql
# A migração duas vezes (idempotência): o usuário reaplica quando fica na dúvida.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0174.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/0174.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
# O script de reparo das peças que JÁ estão presas: ensaio não grava; aplicar solta e guarda o backup.
docker cp docs/operacao/correcao-reparo-rota/02-reparar.sql "$NOME":/tmp/reparar.sql
docker cp docs/operacao/correcao-reparo-rota/01-diagnostico.sql "$NOME":/tmp/diag.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "insert into sf_registros (posto, pmo, op, numero_serie, numero_serie_norm, posto_origem, posto_retorno) values ('Manutenção','PMOB','2002','SN-PRESA','sn-presa','Teste','Inspeção PTH,Teste')"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -f /tmp/diag.sql | grep -q "SN-PRESA" || { echo "diagnóstico não achou a peça presa"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/reparar.sql >/dev/null
docker exec "$NOME" psql -U postgres -tAq -c "select posto_retorno from sf_registros where numero_serie_norm='sn-presa'" | grep -qx "Inspeção PTH,Teste" || { echo "o ensaio gravou!"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -v aplicar=1 -f /tmp/reparar.sql >/dev/null
test -z "$(docker exec "$NOME" psql -U postgres -tAq -c "select posto_retorno from sf_registros where numero_serie_norm='sn-presa'")" || { echo "a peça continuou presa"; exit 1; }
docker exec "$NOME" psql -U postgres -tAq -c "select count(*) from correcao_reparo_rota_bkp" | grep -qx 1 || { echo "backup não gravado"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -f /tmp/diag.sql | grep -q "SN-PRESA" && { echo "a peça ainda aparece como presa"; exit 1; }
echo "reparo das presas (ensaio não grava / aplicar solta / backup / diagnóstico limpo): ok"
echo "REPARO ROTA SQL OK"
