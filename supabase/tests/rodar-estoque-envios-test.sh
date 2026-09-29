#!/usr/bin/env bash
# Testes SQL da fila de envio de estoque ao Compels (migração 0132) num Postgres descartável.
# Uso: supabase/tests/rodar-estoque-envios-test.sh
#
# A 0132 é aplicada de dentro do próprio estoque_envios_test.sql (que primeiro cria os stubs de
# role/RBAC de que ela depende) e DEPOIS mais duas vezes com `psql -1`, exatamente como roda no RDS:
# assim o teste também prova que a migração passa inteira como transação única e que reaplicar não
# falha nem muda resultado.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-estoque-envios-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/migrations/0132_sf_estoque_envios.sql "$NOME":/tmp/0132.sql
docker cp supabase/tests/estoque_envios_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }

# ---------- CONCORRÊNCIA: duas reservas ao mesmo tempo não pegam a MESMA linha ----------
# É o risco que a reserva existe pra resolver: duas rodadas do cron (ou o cron e um reenviar) que se
# cruzam mandariam a MESMA entrada duas vezes ao ERP. A sessão A reserva 1 linha dentro de uma
# transação e segura com pg_sleep (a linha fica travada, sem commit); a B reserva 1 linha ~1 s
# depois, com lock_timeout de 500 ms. Com `for update skip locked` a B NÃO espera e pega OUTRA linha:
# se esperasse, estouraria o lock_timeout; se pegasse a mesma, os dois ids seriam iguais.
sessao >/dev/null <<'SQL'
update sf_estoque_envios set cancelado_em = now() where cancelado_em is null and not ok;
insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, criado_em)
select 'CONC/E' || g, 'PMOT01', '9900', 'Almoxarifado', 'caixa',
       'CX[' || g || '][14]9900-PMOT01', 14, now() - make_interval(mins => g)
  from generate_series(1, 3) g;
SQL

set +e
sessao >"$TMPD/a.out" 2>"$TMPD/a.err" <<'SQL' &
set role service_role;
begin;
select chave from sf_estoque_reservar(1);
select pg_sleep(3);
commit;
SQL
PA=$!
sleep 1
B=$(sessao 2>"$TMPD/b.err" <<'SQL'
set role service_role;
set lock_timeout = '500ms';
select chave from sf_estoque_reservar(1);
SQL
)
wait "$PA"
set -e
A=$(head -n1 "$TMPD/a.out" | tr -d '[:space:]')
B=$(tr -d '[:space:]' <<<"$B")
N=$(sessao <<'SQL'
select count(*) from sf_estoque_envios where op = '9900' and tentativas = 1 and reservado_em is not null;
SQL
)
if [ -n "$A" ] && [ -n "$B" ] && [ "$A" != "$B" ] && [ "$(tr -d '[:space:]' <<<"$N")" = 2 ]; then
  echo "reserva concorrente (A=$A, B=$B): ok"
else
  echo "reserva concorrente FALHOU (A='$A' B='$B' reservadas='$N')"
  cat "$TMPD/a.err" "$TMPD/b.err"
  exit 1
fi

# ---------- IDEMPOTÊNCIA DA MIGRAÇÃO ----------
# O usuário reaplica migração quando fica na dúvida: rodar de novo não pode falhar nem mudar o que
# está na fila. Roda DUAS vezes (a segunda prova que nem a primeira reaplicação deixou resíduo) e
# confere depois que os dados continuam lá e que a chave única continua valendo.
ANTES=$(sessao <<'SQL'
select count(*) || '/' || count(*) filter (where ok) || '/' || count(*) filter (where cancelado_em is not null)
  from sf_estoque_envios;
SQL
)
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
DEPOIS=$(sessao <<'SQL'
select count(*) || '/' || count(*) filter (where ok) || '/' || count(*) filter (where cancelado_em is not null)
  from sf_estoque_envios;
SQL
)
# o raise notice sai no stderr do psql, por isso o 2>&1 dentro da substituição
DUP=$({ sessao <<'SQL'
do $t$
begin
  insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
  values ('CONC/E1', 'PMOT01', '9900', 'Almoxarifado', 'caixa', 'CX[1][14]9900-PMOT01', 14);
  raise notice 'DUPLICOU';
exception when unique_violation then raise notice 'RECUSOU';
end $t$;
SQL
} 2>&1 | tr -d '[:space:]')
if [ "$ANTES" = "$DEPOIS" ] && [[ "$DUP" == *RECUSOU* ]]; then
  echo "idempotência da 0132 (contagens $ANTES intactas, chave única de pé): ok"
else
  echo "idempotência da 0132 FALHOU (antes=$ANTES depois=$DEPOIS duplicata=$DUP)"
  exit 1
fi

# ---------- A GUARDA DO ÍNDICE: reaplicar em cima de uma DEFINIÇÃO ANTIGA troca o índice ----------
# `create index if not exists` olha só o NOME. Numa base que já tenha sf_estoque_envios_alvo com a
# definição de antes (a que tinha o rabo `seq_chave desc, criado_em desc, id desc`), reaplicar a migração
# não faria nada e deixaria o índice velho de pé EM SILÊNCIO — e a consequência é perda de performance,
# não erro, então nada acusaria. Aqui a definição antiga é instalada À MÃO e a 0132 reaplicada: ela tem
# que derrubar e recriar. O bloco de idempotência acima não pega isso porque ali o índice já está na
# definição nova.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "drop index sf_estoque_envios_alvo" \
  -c "create index sf_estoque_envios_alvo on public.sf_estoque_envios
        (pmo, op, posto, alvo, operacao, seq_chave desc nulls last, criado_em desc, id desc)"
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
DEF=$(sessao <<'SQL'
select indexdef from pg_indexes where schemaname = 'public' and indexname = 'sf_estoque_envios_alvo';
SQL
)
ESPERADA="CREATE INDEX sf_estoque_envios_alvo ON public.sf_estoque_envios USING btree (pmo, op, posto, alvo, operacao)"
if [ "$DEF" = "$ESPERADA" ]; then
  echo "guarda do índice (definição antiga é substituída na reaplicação): ok"
else
  echo "guarda do índice FALHOU: o índice ficou como '$DEF'"
  exit 1
fi

# ---------- A migração passa inteira, do zero, como TRANSAÇÃO ÚNICA ----------
# É assim que ela roda no RDS (psql -1). Num banco limpo, com só o stub da permissão de que ela
# depende: se qualquer instrução dela não puder rodar dentro de transação (ou se faltar alguma
# dependência), estoura aqui e não no dia da aplicação.
docker exec "$NOME" createdb -U postgres limpo
docker exec "$NOME" psql -U postgres -d limpo -v ON_ERROR_STOP=1 -q -c \
  "create function public.tem_permissao(p_modulo text, p_perm text) returns boolean
     language sql stable as \$f\$ select false \$f\$"
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0132.sql
echo "0132 do zero, em transação única: ok"

echo "ESTOQUE ENVIOS OK"
