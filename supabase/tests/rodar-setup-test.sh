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

# ---------- Concorrência ----------
# Cada sessão psql define teste.uid/teste.perms na MESMA conexão da chamada (heredoc via stdin).
# A sessão 1 segura a transação aberta com pg_sleep; a sessão 2 começa ~1s depois, então as duas
# se sobrepõem de verdade. Sem a trava (pg_advisory_xact_lock antes de ler/decidir), os dois casos falham.
USUARIO=00000000-0000-0000-0000-000000000001
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }
consulta() { docker exec "$NOME" psql -U postgres -tAq -c "$1"; }
SID=$(consulta "select id from st_setups where op='9002' and face='TOP'")
FALHAS=0

# Caso A: o mesmo rolo (grafias equivalentes) em duas posições ao mesmo tempo → só um entra,
# e o perdedor recebe ROLO_JA_MONTADO (decidido sob a trava), não erro de índice único.
set +e
sessao >/dev/null 2>"$TMPD/a1.err" <<SQL &
select set_config('teste.uid','$USUARIO',false), set_config('teste.perms','setup.visualizar,setup.lancar',false);
begin;
select st_incluir_item('$SID','50','F50','CAPJ41-0042');
select pg_sleep(3);
commit;
SQL
PA1=$!
sleep 1
sessao >/dev/null 2>"$TMPD/a2.err" <<SQL
select set_config('teste.uid','$USUARIO',false), set_config('teste.perms','setup.visualizar,setup.lancar',false);
select st_incluir_item('$SID','51','F51','CAPJ41-42');
SQL
RA2=$?
wait "$PA1"; RA1=$?
set -e
NA=$(consulta "select count(*) from st_setup_itens where setup_id='$SID' and rolo_chave='CAPJ41-42'")
if [ "$RA1" = 0 ] && [ "$RA2" != 0 ] && grep -q ROLO_JA_MONTADO "$TMPD/a2.err" \
   && ! grep -q "duplicate key" "$TMPD/a2.err" && [ "$NA" = 1 ]; then
  echo "concorrência A (mesmo rolo): ok"
else
  echo "concorrência A (mesmo rolo) FALHOU: rc1=$RA1 rc2=$RA2 itens=$NA"
  cat "$TMPD/a1.err" "$TMPD/a2.err"
  FALHAS=$((FALHAS + 1))
fi

# Caso B: liberar × incluir. Quem só tem lancar e chega enquanto o setup está sendo liberado
# tem que esperar a liberação e receber SETUP_LIBERADO.
ANTES=$(consulta "select count(*) from st_setup_itens where setup_id='$SID'")
set +e
sessao >/dev/null 2>"$TMPD/b1.err" <<SQL &
select set_config('teste.uid','$USUARIO',false), set_config('teste.perms','setup.visualizar,setup.lancar',false);
begin;
select st_liberar_setup('$SID');
select pg_sleep(3);
commit;
SQL
PB1=$!
sleep 1
sessao >/dev/null 2>"$TMPD/b2.err" <<SQL
select set_config('teste.uid','$USUARIO',false), set_config('teste.perms','setup.visualizar,setup.lancar',false);
select st_incluir_item('$SID','52','F52','RESR85-52');
SQL
RB2=$?
wait "$PB1"; RB1=$?
set -e
DEPOIS=$(consulta "select count(*) from st_setup_itens where setup_id='$SID'")
ESTADO=$(consulta "select estado from st_setups where id='$SID'")
if [ "$RB1" = 0 ] && [ "$RB2" != 0 ] && grep -q SETUP_LIBERADO "$TMPD/b2.err" \
   && [ "$ANTES" = "$DEPOIS" ] && [ "$ESTADO" = liberado ]; then
  echo "concorrência B (liberar × incluir): ok"
else
  echo "concorrência B (liberar × incluir) FALHOU: rc1=$RB1 rc2=$RB2 itens $ANTES→$DEPOIS estado=$ESTADO"
  cat "$TMPD/b1.err" "$TMPD/b2.err"
  FALHAS=$((FALHAS + 1))
fi

[ "$FALHAS" = 0 ] && echo "CONCORRÊNCIA OK" || { echo "CONCORRÊNCIA FALHOU ($FALHAS caso(s))"; exit 1; }
