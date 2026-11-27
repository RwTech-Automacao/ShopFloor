#!/usr/bin/env bash
# Testes SQL da 0199 (Nova OP: ignorar uma PRT; incluir de novo na edição) num Postgres descartável.
# Uso: supabase/tests/rodar-ignorar-prt-test.sh
# Monta o estado vigente como o rodar-prt-agrupar-test.sh (esquema mínimo da 0184 + Integração, a reserva real da 0132,
# 0153, 0184, 0194, 0066, a sf_cancelar_lancamento da 0165, 0195 e 0197), confere que a 0199 só ACRESCENTA linhas à
# sf_ordem_regravar_trechos da 0197, aplica a 0199 DUAS vezes (idempotência), roda a prova (ignorar_prt_test.sql), o
# rollback (duas vezes; devolve as funções ao texto da 0197 byte a byte) e a 0199 de novo.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-ignorar-prt-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
extrai() { # $1 = início da função, $2 = arquivo, $3 = linha que fecha, $4 = saída
  awk -v f="$1" -v fim="$3" '
    index($0, f) == 1 { dentro = 1 }
    dentro { print }
    dentro && $0 == fim { exit }' "$2" > "$4"
  [ -s "$4" ] || { echo "$1 não encontrada em $2"; exit 1; }
}
# ---------- a 0199 só acrescenta à sf_ordem_regravar_trechos da 0197 (nenhuma linha some nem muda) ----------
extrai "create or replace function public.sf_ordem_regravar_trechos(" supabase/migrations/0197_prt_apontamento_automatico.sql '$func$;' "$TMPD/rt-0197.sql"
extrai "create or replace function public.sf_ordem_regravar_trechos(" supabase/migrations/0199_ignorar_prt.sql '$func$;' "$TMPD/rt-0199.sql"
if diff "$TMPD/rt-0197.sql" "$TMPD/rt-0199.sql" | grep -q '^<'; then echo "a 0199 mudou linha da regravação da 0197"; exit 1; fi
[ "$(diff "$TMPD/rt-0197.sql" "$TMPD/rt-0199.sql" | grep -c '^>')" = 5 ] || { echo "a 0199 devia acrescentar 5 linhas à regravação"; exit 1; }

extrai "create or replace function public.sf_sn_na_faixa(" supabase/migrations/0129_sf_almoxarifado_entrada.sql 'end $func$;' "$TMPD/sf_sn_na_faixa.sql"
extrai "create or replace function public.sf_cancelar_lancamento(" supabase/migrations/0165_placas_almoxarifado.sql '$func$;' "$TMPD/cancelar.sql"
extrai "create or replace function public.sf_estoque_reservar(" supabase/migrations/0132_sf_estoque_envios.sql '$func$;' "$TMPD/reservar.sql"
for F in sf_sn_na_faixa cancelar reservar; do docker cp "$TMPD/$F.sql" "$NOME":/tmp/$F.sql; done
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/tests/receita_prt_esquema.sql "$NOME":/tmp/esquema-integracao.sql
for M in 0153_sf_estoque_enviado 0184_estrutura_op 0194_editar_op_trechos 0066_sf_integracoes_por_posto 0195_receita_integracao_prt 0197_prt_apontamento_automatico 0199_ignorar_prt; do
  docker cp "supabase/migrations/$M.sql" "$NOME":/tmp/"${M%%_*}".sql
done
docker cp supabase/tests/ignorar_prt_test.sql "$NOME":/tmp/teste.sql
docker cp docs/operacao/estrutura-op/rollback-0199.sql "$NOME":/tmp/rollback.sql
P() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
Q() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq "$@"; }
P -f /tmp/esquema.sql
P -f /tmp/esquema-integracao.sql
P -f /tmp/sf_sn_na_faixa.sql
P -c "revoke all on function public.sf_estoque_reservar(int) from public, anon, authenticated" \
  -c "drop function public.sf_estoque_reservar(int)"
P -1 -f /tmp/reservar.sql   # a reserva REAL da 0132 (a do esquema mínimo é uma cópia sem comentários)
P -c "revoke all on function public.sf_estoque_reservar(int) from public, anon, authenticated" \
  -c "grant execute on function public.sf_estoque_reservar(int) to service_role"
P -1 -f /tmp/0153.sql
P -1 -f /tmp/0184.sql
P -1 -f /tmp/0194.sql
P -1 -f /tmp/0066.sql
P -1 -f /tmp/cancelar.sql
P -1 -f /tmp/0195.sql
P -1 -f /tmp/0197.sql
DEFS="select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('sf_cadastrar_op','sf_ordem_regravar_trechos','sf_trecho_enfileirar','sf_prt_agrupar')"
Q -c "$DEFS" > "$TMPD/defs-antes.txt"
P -1 -f /tmp/0199.sql
P -1 -f /tmp/0199.sql   # idempotente
Q -c "$DEFS" > "$TMPD/defs-0199.txt"
cmp -s "$TMPD/defs-antes.txt" "$TMPD/defs-0199.txt" && { echo "a 0199 não mudou a regravação"; exit 1; }
# só a sf_ordem_incluir_trechos é nova, e ninguém de fora a chama
Q -c "select has_function_privilege('authenticated', 'public.sf_ordem_incluir_trechos(uuid,text,text,jsonb)', 'execute')" | grep -qx f \
  || { echo "authenticated não pode executar a sf_ordem_incluir_trechos"; exit 1; }
P -f /tmp/teste.sql

P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "$DEFS" > "$TMPD/defs-rollback.txt"
diff "$TMPD/defs-antes.txt" "$TMPD/defs-rollback.txt" || { echo "rollback não devolveu as funções da 0197"; exit 1; }
Q -c "select count(*) from pg_proc where proname = 'sf_ordem_incluir_trechos'" | grep -qx 0 || { echo "rollback não removeu a sf_ordem_incluir_trechos"; exit 1; }
P -1 -f /tmp/0199.sql   # volta depois do rollback
Q -c "$DEFS" > "$TMPD/defs-volta.txt"
diff "$TMPD/defs-0199.txt" "$TMPD/defs-volta.txt" || { echo "a 0199 depois do rollback ficou diferente"; exit 1; }
echo "IGNORAR PRT SQL OK"
