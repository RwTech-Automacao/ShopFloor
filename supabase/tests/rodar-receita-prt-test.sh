#!/usr/bin/env bash
# Testes SQL da 0195 (receita da Integração com PRT da estrutura) num Postgres descartável.
# Uso: supabase/tests/rodar-receita-prt-test.sh
# Monta o esquema mínimo da 0184 (estrutura_op_esquema.sql) + o da Integração (receita_prt_esquema.sql), a 0184 real,
# a sf_sn_na_faixa real da 0129 (extraída do arquivo), a 0194 e a 0066 (a sf_integrar vigente), e aplica a 0195 DUAS
# vezes (idempotência). Depois o rollback (duas vezes), que tem que devolver as três funções ao texto anterior, e a
# 0195 de novo. A prova do cadastro da 0184 (cadastro_op_prova.sql) roda contra a sf_cadastrar_op da 0195.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-receita-prt-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
awk -v f="create or replace function public.sf_sn_na_faixa(" '
  index($0, f) == 1 { dentro = 1 }
  dentro { print }
  dentro && $0 == "end $func$;" { exit }' supabase/migrations/0129_sf_almoxarifado_entrada.sql > "$TMPD/sf_sn_na_faixa.sql"
[ -s "$TMPD/sf_sn_na_faixa.sql" ] || { echo "sf_sn_na_faixa não encontrada na 0129"; exit 1; }
docker cp "$TMPD/sf_sn_na_faixa.sql" "$NOME":/tmp/sf_sn_na_faixa.sql
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/tests/receita_prt_esquema.sql "$NOME":/tmp/esquema-integracao.sql
docker cp supabase/migrations/0184_estrutura_op.sql "$NOME":/tmp/0184.sql
docker cp supabase/migrations/0194_editar_op_trechos.sql "$NOME":/tmp/0194.sql
docker cp supabase/migrations/0066_sf_integracoes_por_posto.sql "$NOME":/tmp/0066.sql
docker cp supabase/migrations/0195_receita_integracao_prt.sql "$NOME":/tmp/0195.sql
docker cp supabase/tests/receita_prt_test.sql "$NOME":/tmp/teste.sql
docker cp supabase/tests/cadastro_op_prova.sql "$NOME":/tmp/cadastro.sql
docker cp docs/operacao/estrutura-op/rollback-0195.sql "$NOME":/tmp/rollback.sql
P() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
Q() { docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq "$@"; }
P -f /tmp/esquema.sql
P -f /tmp/esquema-integracao.sql
P -f /tmp/sf_sn_na_faixa.sql
P -1 -f /tmp/0184.sql
P -1 -f /tmp/0194.sql
P -1 -f /tmp/0066.sql
DEFS="select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) from pg_proc p where p.proname in ('sf_integrar','sf_cadastrar_op','sf_ordem_regravar_trechos')"
Q -c "$DEFS" > "$TMPD/defs-antes.txt"
P -1 -f /tmp/0195.sql
P -1 -f /tmp/0195.sql   # idempotente
Q -c "$DEFS" > "$TMPD/defs-0195.txt"
cmp -s "$TMPD/defs-antes.txt" "$TMPD/defs-0195.txt" && { echo "a 0195 não mudou as funções"; exit 1; }
P -f /tmp/teste.sql
P -f /tmp/cadastro.sql   # a prova do cadastro da 0184 continua valendo na sf_cadastrar_op da 0195

P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "$DEFS" > "$TMPD/defs-rollback.txt"
diff "$TMPD/defs-antes.txt" "$TMPD/defs-rollback.txt" || { echo "rollback não devolveu as funções anteriores"; exit 1; }
P -1 -f /tmp/0195.sql   # volta depois do rollback
Q -c "$DEFS" > "$TMPD/defs-volta.txt"
diff "$TMPD/defs-0195.txt" "$TMPD/defs-volta.txt" || { echo "a 0195 depois do rollback ficou diferente"; exit 1; }
echo "RECEITA PRT SQL OK"
