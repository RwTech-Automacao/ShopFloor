#!/usr/bin/env bash
# Testes SQL da fila de prioridade da baixa de NF (migração 0185) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-fat-fila-baixa-nf-test.sh
#
# A 0185 é aplicada de dentro do próprio fat_fila_baixa_nf_test.sql (que primeiro cria os stubs de role/RBAC
# de que ela depende) e DEPOIS mais duas vezes com `psql -1`, como roda no RDS: prova que passa inteira como
# transação única e que reaplicar não falha nem mexe na fila.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-fat-fila-baixa-nf-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/migrations/0185_fat_fila_baixa_nf.sql "$NOME":/tmp/0185.sql
docker cp supabase/tests/fat_fila_baixa_nf_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }

# ---------- IDEMPOTÊNCIA: reaplicar 2x não falha nem muda a fila; o índice único continua de pé ----------
ANTES=$(sessao <<'SQL'
select count(*) || '/' || count(*) filter (where status = 'aguardando') || '/' || max(posicao) from fat_fila_baixa_nf;
SQL
)
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0185.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0185.sql
DEPOIS=$(sessao <<'SQL'
select count(*) || '/' || count(*) filter (where status = 'aguardando') || '/' || max(posicao) from fat_fila_baixa_nf;
SQL
)
DUP=$({ sessao <<'SQL'
do $t$
begin
  insert into fat_fila_baixa_nf (nota_id, numero) values (1001, 80);
  raise notice 'DUPLICOU';
exception when unique_violation then raise notice 'RECUSOU';
end $t$;
SQL
} 2>&1 | tr -d '[:space:]')
# a posição continua crescendo depois da reaplicação (a sequência não volta)
NOVA=$(sessao <<'SQL'
insert into fat_fila_baixa_nf (nota_id, numero) values (5001, 99) returning posicao;
SQL
)
MAX=$(cut -d/ -f3 <<<"$DEPOIS")
if [ "$ANTES" = "$DEPOIS" ] && [[ "$DUP" == *RECUSOU* ]] && [ "$(tr -d '[:space:]' <<<"$NOVA")" -gt "$MAX" ]; then
  echo "idempotência da 0185 (contagens $ANTES intactas, índice único de pé, posição segue crescendo): ok"
else
  echo "idempotência da 0185 FALHOU (antes=$ANTES depois=$DEPOIS duplicata=$DUP nova=$NOVA)"
  exit 1
fi

# ---------- A policy usa o InitPlan: (select tem_permissao(...)), nunca a chamada por linha ----------
POL=$(sessao <<'SQL'
select qual from pg_policies where tablename = 'fat_fila_baixa_nf' and policyname = 'fat_fila_baixa_nf_select';
SQL
)
if [[ "$POL" == *"SELECT tem_permissao('faturamento'::text, 'visualizar'::text)"* ]]; then
  echo "policy em InitPlan: ok"
else
  echo "policy FALHOU: '$POL'"
  exit 1
fi

# ---------- Do zero, como TRANSAÇÃO ÚNICA (como roda no RDS) ----------
docker exec "$NOME" createdb -U postgres limpo
docker exec "$NOME" psql -U postgres -d limpo -v ON_ERROR_STOP=1 -q \
  -c "create role anon_x" \
  -c "create schema auth" \
  -c "create function auth.uid() returns uuid language sql stable as \$f\$ select null::uuid \$f\$" \
  -c "create table public.usuarios (id uuid primary key, nome text not null default '', email text not null default '')" \
  -c "create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as \$f\$ select false \$f\$"
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0185.sql
echo "0185 do zero, em transação única: ok"

echo "FAT FILA BAIXA NF OK"
