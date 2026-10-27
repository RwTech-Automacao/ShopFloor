#!/usr/bin/env bash
# Teste SQL do NQA (caixa e individual) em placas (0166) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-placas-nqa-test.sh
# Aplica as migrações REAIS na ordem (0161, 0097, 0130, 0160) sobre o esquema mínimo, carrega a massa
# N = 1 e tira a foto do NQA com as funções antigas (foto_antes). Aplica a 0166 DUAS vezes
# (idempotência), tira a foto de novo (foto_depois) e exige as duas IDÊNTICAS. Depois roda o
# placas_nqa_test.sql (N = 50) e o nqa_caixa_plano_test.sql (plano estável da 0160 preservado).
# RED=1 pula a 0166 (roda contra as funções antigas: o placas_nqa_test.sql tem de falhar).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-placas-nqa-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

for m in 0161_placas_por_painel 0097_sf_nqa_individual 0130_sf_nqa_caixa_posto_da_caixa \
         0160_sf_nqa_caixa_plano_estavel; do
  docker cp "supabase/migrations/$m.sql" "$NOME":/tmp/"${m%%_*}".sql
done
[ -n "${RED:-}" ] || docker cp supabase/migrations/0166_placas_nqa.sql "$NOME":/tmp/0166.sql
for f in placas_nqa_esquema placas_nqa_massa placas_nqa_foto placas_nqa_test nqa_caixa_plano_test; do
  docker cp "supabase/tests/$f.sql" "$NOME":/tmp/"$f".sql
done

p()  { docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f "$1"; }
q()  { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }

q -f /tmp/placas_nqa_esquema.sql
p /tmp/0161.sql; p /tmp/0097.sql; p /tmp/0130.sql; p /tmp/0160.sql
q -f /tmp/placas_nqa_massa.sql

if [ -z "${RED:-}" ]; then
  q -v tabela=foto_antes -f /tmp/placas_nqa_foto.sql
  p /tmp/0166.sql
  p /tmp/0166.sql   # de novo: idempotente
  q -v tabela=foto_depois -f /tmp/placas_nqa_foto.sql
  DIF=$(docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c "
    select (select count(*) from foto_antes) || '/' ||
           (select count(*) from ((select * from foto_depois) except all (select * from foto_antes)) x) || '/' ||
           (select count(*) from ((select * from foto_antes) except all (select * from foto_depois)) y)")
  case "$DIF" in
    0/*) echo "foto N=1 FALHOU: foto vazia ($DIF)"; exit 1 ;;
    */0/0) echo "foto N=1 do NQA (caixa e individual, retornos + linhas gravadas + aposentadoria): idênticas ($DIF): ok" ;;
    *) echo "foto N=1 FALHOU (cenários/só-depois/só-antes = $DIF)"
       docker exec "$NOME" psql -U postgres -c "
         (select 'depois' as lado, * from foto_depois except all select 'depois', * from foto_antes)
         union all (select 'antes', * from foto_antes except all select 'antes', * from foto_depois)"
       exit 1 ;;
  esac
  # A foto tem de ter exercitado os dois lados: cenários que gravam e cenários que recusam.
  docker exec "$NOME" psql -U postgres -tAq -c \
    "select count(*) filter (where erro is null) || ' gravaram, ' || count(*) filter (where erro is not null) || ' recusaram' from foto_depois"
  docker exec "$NOME" psql -U postgres -tAq -F ' | ' -c \
    "select cenario, coalesce(erro, 'total=' || (retorno->>'total')), coalesce(jsonb_array_length(linhas), 0) || ' linhas'
       from foto_depois order by cenario"
fi

q -f /tmp/placas_nqa_test.sql
q -f /tmp/nqa_caixa_plano_test.sql
echo "plano estável da sf_nqa_caixa preservado: ok"
echo "PLACAS NQA SQL OK"
