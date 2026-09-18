#!/usr/bin/env bash
# Testes SQL dos alertas num Postgres descartável (Docker). Uso: supabase/tests/rodar-alertas-test.sh
#
# A 0113 é aplicada com `psql -1 -v ON_ERROR_STOP=1 -f`, exatamente como roda no RDS — assim o
# teste também garante que a migração passa inteira como transação única. A 0114 usa `create index
# concurrently`, que não roda dentro de transação nenhuma (nem com -1), então vai à parte, sem -1.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-alertas-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/_stubs.sql "$NOME":/tmp/_stubs.sql
docker cp supabase/migrations/0113_alertas.sql "$NOME":/tmp/0113.sql
docker cp supabase/migrations/0114_sf_registros_posto_data_idx.sql "$NOME":/tmp/0114.sql
docker cp supabase/tests/alertas_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/_stubs.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0113.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0114.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
# ---------- Concorrência: a trava do alerta_avaliar ----------
# A sessão 1 roda alerta_avaliar dentro de uma transação e segura com pg_sleep; a sessão 2 começa
# ~1 s depois. Sem pg_try_advisory_xact_lock as duas avaliariam ao mesmo tempo e o mesmo posto
# viraria dois alertas (ou um erro de índice único).
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }

set +e
sessao >"$TMPD/s1.out" 2>"$TMPD/s1.err" <<'SQL' &
set role service_role;
begin;
select alerta_avaliar()->>'ocupado';
select pg_sleep(3);
commit;
SQL
P1=$!
sleep 1
OCUPADO=$(sessao 2>"$TMPD/s2.err" <<'SQL'
set role service_role;
select alerta_avaliar()->>'ocupado';
SQL
)
wait "$P1"
set -e

if [ "$(tr -d '[:space:]' <<<"$OCUPADO")" = "true" ]; then
  echo "trava do alerta_avaliar: ok"
else
  echo "trava do alerta_avaliar FALHOU: ocupado='$OCUPADO'"
  cat "$TMPD/s1.err" "$TMPD/s2.err"
  exit 1
fi

# ---------- Concorrência: a trava do alerta_vincular por (canal, externo_id) ----------
# Sem pg_advisory_xact_lock, duas chamadas simultâneas do mesmo (canal, externo_id) contariam as
# falhas ao mesmo tempo e passariam juntas do limite de 5. Com a trava, a sessão 2 ESPERA a 1
# terminar: enquanto a 1 dorme, a sessão 3 tem que ver um advisory lock NÃO concedido (a 2 na fila),
# e no fim as duas falhas estão gravadas.
set +e
sessao >"$TMPD/v1.out" 2>"$TMPD/v1.err" <<'SQL' &
set role service_role;
begin;
select alerta_vincular('ALERTA-ZZZZ', 'telegram', 'LK1')->>'erro';
select pg_sleep(4);
commit;
SQL
V1=$!
sleep 1
sessao >"$TMPD/v2.out" 2>"$TMPD/v2.err" <<'SQL' &
set role service_role;
select alerta_vincular('ALERTA-ZZZZ', 'telegram', 'LK1')->>'erro';
SQL
V2=$!
sleep 1
ESPERANDO=$(sessao 2>"$TMPD/v3.err" <<'SQL'
select count(*) from pg_locks where locktype = 'advisory' and not granted;
SQL
)
wait "$V1"; wait "$V2"
TENTATIVAS=$(sessao 2>>"$TMPD/v3.err" <<'SQL'
select count(*) from alerta_tentativas where canal = 'telegram' and externo_id = 'LK1';
SQL
)
set -e

if [ "$(tr -d '[:space:]' <<<"$ESPERANDO")" = "1" ] && [ "$(tr -d '[:space:]' <<<"$TENTATIVAS")" = "2" ]; then
  echo "trava do alerta_vincular: ok"
else
  echo "trava do alerta_vincular FALHOU: esperando='$ESPERANDO' tentativas='$TENTATIVAS'"
  cat "$TMPD/v1.err" "$TMPD/v2.err" "$TMPD/v3.err"
  exit 1
fi

echo "ALERTAS SQL OK"
