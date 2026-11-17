#!/usr/bin/env bash
# Testes SQL do SAT (migração 0186) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-sat-test.sh
#
# A 0186 é aplicada de dentro do próprio sat_test.sql (que primeiro cria os stubs de role/RBAC e das tabelas do
# repinmetro e do ShopFloor de que ela lê) e DEPOIS mais duas vezes com `psql -1`, como roda no RDS: prova que
# passa inteira como transação única e que reaplicar não falha nem mexe nos dados.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-sat-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/migrations/0186_sat_entrada.sql "$NOME":/tmp/0186.sql
docker cp supabase/tests/sat_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }

# ---------- IDEMPOTÊNCIA: reaplicar 2x não falha nem muda os dados ----------
CONTAGEM="select (select count(*) from sat_os) || '/' || (select count(*) from sat_os_itens) || '/' ||
  (select count(*) from sat_motivos_nf) || '/' || (select count(*) from sat_entradas) || '/' ||
  (select count(*) from sat_entradas_historico);"
ANTES=$(sessao <<<"$CONTAGEM")
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0186.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0186.sql
DEPOIS=$(sessao <<<"$CONTAGEM")
if [ "$ANTES" = "$DEPOIS" ]; then
  echo "idempotência da 0186 (contagens $ANTES intactas): ok"
else
  echo "idempotência da 0186 FALHOU (antes=$ANTES depois=$DEPOIS)"
  exit 1
fi

# ---------- As 5 policies usam o InitPlan: (select tem_permissao(...)), nunca a chamada por linha ----------
POLS=$(sessao <<'SQL'
select count(*) from pg_policies
 where tablename like 'sat\_%' and cmd = 'SELECT'
   and qual like '%SELECT tem_permissao(''sat''::text, ''visualizar''::text)%';
SQL
)
TOTAL=$(sessao <<'SQL'
select count(*) from pg_policies where tablename like 'sat\_%';
SQL
)
if [ "$POLS" = "5" ] && [ "$TOTAL" = "5" ]; then
  echo "5 policies de leitura em InitPlan, nenhuma de escrita: ok"
else
  echo "policies FALHARAM (InitPlan=$POLS total=$TOTAL)"
  exit 1
fi

# ---------- Do zero, como TRANSAÇÃO ÚNICA (como roda no RDS) ----------
docker exec "$NOME" createdb -U postgres limpo
docker exec "$NOME" psql -U postgres -d limpo -v ON_ERROR_STOP=1 -q \
  -c "create schema auth" \
  -c "create function auth.uid() returns uuid language sql stable as \$f\$ select null::uuid \$f\$" \
  -c "create table public.usuarios (id uuid primary key, nome text not null default '', email text not null default '')" \
  -c "create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as \$f\$ select false \$f\$"
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0186.sql
echo "0186 do zero, em transação única: ok"

echo "SAT OK"
