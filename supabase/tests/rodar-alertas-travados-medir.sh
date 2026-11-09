#!/usr/bin/env bash
# Mede alerta_travados (0172) numa massa de ~850 mil registros, num Postgres descartável (Docker). Uso:
#   bash supabase/tests/rodar-alertas-travados-medir.sh
# Só precisa do _stubs.sql + esquema mínimo + a função extraída da 0172 (não aplica as outras migrações).
# Mede duas vezes: SEM analyze (tabela nova, sem estatística) e COM analyze, nos dois modos da regra
# (só OPs ativas; todas), e como role que NÃO é superusuário (o service_role de produção).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-travados-medir
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
psqlx() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
docker cp supabase/tests/_stubs.sql "$NOME":/tmp/_stubs.sql
docker cp supabase/tests/alertas_travados_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/tests/alertas_travados_massa.sql "$NOME":/tmp/massa.sql
psqlx -f /tmp/_stubs.sql
psqlx -f /tmp/esquema.sql
# A função, do `create or replace function public.alerta_travados(` até o `$func$;` seguinte, + grants.
awk 'index($0,"create or replace function public.alerta_travados(")==1{p=1} p{print} p&&/^revoke all on function public.alerta_travados/{q=1} q&&/^grant execute on function public.alerta_travados/{exit}' \
  supabase/migrations/0172_alerta_parado_travado.sql > /tmp/travados_fn.sql
docker cp /tmp/travados_fn.sql "$NOME":/tmp/fn.sql
psqlx -f /tmp/fn.sql
psqlx -f /tmp/massa.sql
psqlx -tA -c "select 'registros=' || count(*) from sf_registros"
medir() {
  echo "== $1"
  psqlx -c "set role service_role; explain (analyze, buffers, timing off) select * from public.alerta_travados(array['Inicial','Teste','Embalagem','Inspeção','Almoxarifado','Manutenção'], '{}'::text[], now() - interval '$2', $3, true)" \
    | grep -E "Execution Time|Planning Time"
}
echo "######## SEM ANALYZE (tabela nova, sem estatística)"
medir "so ativas, corte 168 h" "168 hours" true
medir "so ativas, corte 168 h (2a vez)" "168 hours" true
medir "todas, corte 168 h" "168 hours" false
medir "todas, corte 168 h (2a vez)" "168 hours" false
psqlx -tA -c "select 'linhas devolvidas (ativas)=' || count(*) || ' pecas=' || coalesce(sum(pecas),0) from public.alerta_travados(array['Inicial','Teste','Embalagem','Inspeção','Almoxarifado','Manutenção'], '{}'::text[], now() - interval '168 hours', true, true)"
psqlx -tA -c "select 'linhas devolvidas (todas)=' || count(*) || ' pecas=' || coalesce(sum(pecas),0) from public.alerta_travados(array['Inicial','Teste','Embalagem','Inspeção','Almoxarifado','Manutenção'], '{}'::text[], now() - interval '168 hours', false, true)"
psqlx -c "analyze"
echo "######## COM ANALYZE"
medir "so ativas, corte 168 h" "168 hours" true
medir "todas, corte 168 h" "168 hours" false
