#!/usr/bin/env bash
# Testes SQL da 0196 (placa de PRT com série própria que terminou o trecho não fica parada nem pendente) num Postgres
# descartável. Uso: supabase/tests/rodar-prt-fim-trecho-test.sh
# Monta a base de peças paradas (_stubs + esquemas mínimos), aplica 0188 → 0180 → 0193 (o estado vigente) e roda o
# parados_prt_fim_test.sql, que tira a foto da 0193, aplica a 0196 (\i) e confere a regra (desfaz tudo no fim).
# Depois: a 0196 DUAS vezes (idempotência), o rollback (tem que devolver a função da 0193 byte a byte) duas vezes, e
# a 0196 de novo. A prova de equivalência em volume é o medidor:
#   PARADOS_ANTES=supabase/migrations/0193_parados_desempenho.sql \
#   PARADOS_MIGRACAO=supabase/migrations/0196_prt_fim_trecho_terminado.sql PECAS=150 \
#     bash supabase/tests/rodar-parados-medir.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-prt-fim-trecho-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
P() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
Q() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq "$@"; }
for F in _stubs alertas_travados_esquema alertas_ficha_esquema parados_posto_pendente_esquema parados_prt_fim_esquema parados_prt_fim_test; do
  docker cp "supabase/tests/$F.sql" "$NOME":/tmp/$F.sql
done
docker cp supabase/migrations/0188_parados_caixa_aberta_fora_rota.sql "$NOME":/tmp/0188.sql
docker cp supabase/migrations/0180_sf_pecas_paradas.sql "$NOME":/tmp/0180.sql
docker cp supabase/migrations/0193_parados_desempenho.sql "$NOME":/tmp/0193.sql
docker cp supabase/migrations/0196_prt_fim_trecho_terminado.sql "$NOME":/tmp/0196.sql
docker cp docs/operacao/estrutura-op/rollback-0196.sql "$NOME":/tmp/rollback.sql
for F in _stubs alertas_travados_esquema alertas_ficha_esquema parados_posto_pendente_esquema parados_prt_fim_esquema; do
  P -f /tmp/$F.sql
done
P -1 -f /tmp/0188.sql
P -1 -f /tmp/0180.sql
P -1 -f /tmp/0193.sql
DEF="select pg_get_functiondef('public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean)'::regprocedure)"
Q -c "$DEF" > "$TMPD/def-0193.txt"

P -f /tmp/parados_prt_fim_test.sql
echo "0196 (regra + equivalência na massa do teste): ok"

P -1 -f /tmp/0196.sql
P -1 -f /tmp/0196.sql   # idempotente
Q -c "$DEF" > "$TMPD/def-0196.txt"
if diff -q "$TMPD/def-0193.txt" "$TMPD/def-0196.txt" >/dev/null; then echo "a 0196 não mudou a função"; exit 1; fi
P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "$DEF" > "$TMPD/def-rollback.txt"
diff "$TMPD/def-0193.txt" "$TMPD/def-rollback.txt" || { echo "rollback não devolveu a função da 0193"; exit 1; }
Q -c "select has_function_privilege('service_role', 'public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean)', 'execute') and not has_function_privilege('authenticated', 'public.alerta_travados_sns(text[], text[], timestamptz, boolean, boolean)', 'execute')" | grep -qx t || { echo "grants da alerta_travados_sns mudaram"; exit 1; }
P -1 -f /tmp/0196.sql   # volta depois do rollback
echo "PRT FIM DE TRECHO SQL OK"
