#!/usr/bin/env bash
# Testes SQL do SAT (migrações 0186 e 0187) num Postgres descartável (Docker).
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
docker cp supabase/migrations/0187_sat_entrada_por_nf.sql "$NOME":/tmp/0187.sql
docker cp supabase/tests/sat_test.sql "$NOME":/tmp/teste.sql
docker cp supabase/tests/sat_nf_test.sql "$NOME":/tmp/teste_nf.sql
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

# ---------- 0187 (entrada por NF): migra as entradas que o sat_test deixou e testa as funções novas ----------
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_nf.sql
CONTAGEM_NF="select (select count(*) from sat_nfs) || '/' || (select count(*) from sat_entradas) || '/' ||
  (select count(*) from sat_historico) || '/' || (select count(*) from sat_entradas where os_id is not null);"
ANTES=$(sessao <<<"$CONTAGEM_NF")
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0187.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0187.sql
DEPOIS=$(sessao <<<"$CONTAGEM_NF")
if [ "$ANTES" = "$DEPOIS" ]; then
  echo "idempotência da 0187 (contagens $ANTES intactas): ok"
else
  echo "idempotência da 0187 FALHOU (antes=$ANTES depois=$DEPOIS)"
  exit 1
fi

# ---------- As 6 policies usam o InitPlan: (select tem_permissao(...)), nunca a chamada por linha ----------
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
if [ "$POLS" = "6" ] && [ "$TOTAL" = "6" ]; then
  echo "6 policies de leitura em InitPlan, nenhuma de escrita: ok"
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
docker exec "$NOME" psql -U postgres -d limpo -1 -v ON_ERROR_STOP=1 -q -f /tmp/0187.sql
echo "0186 e 0187 do zero, cada uma em transação única: ok"

echo "SAT OK"
