#!/usr/bin/env bash
# Testes SQL da 0195 (receita da Integração com PRT da estrutura) num Postgres descartável.
# Uso: supabase/tests/rodar-receita-prt-test.sh
# Monta o esquema mínimo da 0184 (estrutura_op_esquema.sql) + o da Integração (receita_prt_esquema.sql), a 0184 real,
# a sf_sn_na_faixa real da 0129 (extraída do arquivo), a 0194, a 0066 (a sf_integrar vigente) e a sf_cancelar_lancamento
# da 0165 (extraída), e aplica a 0195 DUAS vezes (idempotência). Depois o rollback (duas vezes), que tem que devolver
# as quatro funções ao texto anterior, e a 0195 de novo. A prova do cadastro da 0184 (cadastro_op_prova.sql) roda contra a sf_cadastrar_op da 0195.
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
awk -v f="create or replace function public.sf_cancelar_lancamento(" '
  index($0, f) == 1 { dentro = 1 }
  dentro { print }
  dentro && $0 == "$func$;" { exit }' supabase/migrations/0165_placas_almoxarifado.sql > "$TMPD/cancelar.sql"
[ -s "$TMPD/cancelar.sql" ] || { echo "sf_cancelar_lancamento não encontrada na 0165"; exit 1; }
docker cp "$TMPD/cancelar.sql" "$NOME":/tmp/cancelar.sql
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
P -1 -f /tmp/cancelar.sql   # a sf_cancelar_lancamento vigente (0165)
DEFS="select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) from pg_proc p where p.proname in ('sf_integrar','sf_cadastrar_op','sf_ordem_regravar_trechos','sf_cancelar_lancamento')"
Q -c "$DEFS" > "$TMPD/defs-antes.txt"
P -1 -f /tmp/0195.sql
P -1 -f /tmp/0195.sql   # idempotente
Q -c "$DEFS" > "$TMPD/defs-0195.txt"
cmp -s "$TMPD/defs-antes.txt" "$TMPD/defs-0195.txt" && { echo "a 0195 não mudou as funções"; exit 1; }
P -f /tmp/teste.sql
P -f /tmp/cadastro.sql   # a prova do cadastro da 0184 continua valendo na sf_cadastrar_op da 0195

# ---------- a corrida entre a Integração e o cancelamento: duas sessões de verdade ----------
# A060 e A061 terminaram a PRT410 (Aprovado no fim do trecho) na PMOE/9100, cuja receita é [PRT410].
P -c "insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm, data_hora) values
  ('Inspeção AOI TOP', 'PMOE', '9100', 'Aprovado', 'A060', 'A060', clock_timestamp()),
  ('Inspeção AOI TOP', 'PMOE', '9100', 'Aprovado', 'A061', 'A061', clock_timestamp())"
P -c "delete from sf_ordem_componentes where ordem_id = (select id from sf_ordens where pmo = 'PMOE' and op = '9100');
      insert into sf_ordem_componentes (ordem_id, posto, pmo_componente) select id, 'Integração', 'PRT410' from sf_ordens where pmo = 'PMOE' and op = '9100'"
INTEG() { echo "select sf_integrar('F', 'C', 'PMOE', '9100', '$1', '$1', '', false, '[{\"pmo\":\"PRT410\",\"op\":\"9100\",\"sn\":\"$2\",\"sn_norm\":\"$2\"}]'::jsonb, 'Integração')"; }
CANC() { echo "select sf_cancelar_lancamento((select id from sf_registros where pmo = 'PMOE' and op = '9100' and numero_serie_norm = '$1' and posto = 'Inspeção AOI TOP'), 'corrida')"; }
segura() { # roda $1 numa sessão que segura a transação por 4 s
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "begin" -c "$1" -c "select pg_sleep(4)" -c "commit" >"$TMPD/segura.out" 2>&1 &
  sleep 1.5
}
# 1) a integração em andamento (sem commit): o cancelamento espera por ela e, depois, recusa com PLACA_INTEGRADA
segura "$(INTEG 170 A060)"
if docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "$(CANC A060)" >/dev/null 2>"$TMPD/c1"; then
  echo "o cancelamento apagou o fim do trecho de uma placa sendo integrada"; exit 1
fi
wait
grep -q '"ok": true\|"ok":true' "$TMPD/segura.out" || { cat "$TMPD/segura.out"; echo "a integração da corrida 1 não passou"; exit 1; }
grep -q "PLACA_INTEGRADA:A060|170|" "$TMPD/c1" || { cat "$TMPD/c1"; exit 1; }
# a prova de que é a trava: com lock_timeout, o cancelamento nem chega a conferir enquanto a integração não termina
segura "$(INTEG 171 A061)"
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '700ms'" -c "$(CANC A061)" >/dev/null 2>"$TMPD/c2"; then echo "cancelamento não esperou a integração"; exit 1; fi
grep -q "lock timeout" "$TMPD/c2" || { cat "$TMPD/c2"; exit 1; }
wait
# 2) o cancelamento em andamento (sem commit): a integração espera por ele e, depois, recusa com PLACA_PRT_INCOMPLETA
P -c "insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm, data_hora) values
  ('Inspeção AOI TOP', 'PMOE', '9100', 'Aprovado', 'A062', 'A062', clock_timestamp())"
segura "$(CANC A062)"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c "$(INTEG 172 A062)" >"$TMPD/i1" 2>&1 || { cat "$TMPD/i1"; exit 1; }
wait
grep -q "PLACA_PRT_INCOMPLETA" "$TMPD/i1" || { cat "$TMPD/i1"; echo "a integração aceitou a placa cujo fim do trecho estava sendo cancelado"; exit 1; }
grep -qi "error" "$TMPD/segura.out" && { cat "$TMPD/segura.out"; echo "o cancelamento da corrida 2 falhou"; exit 1; }
echo "CORRIDA OK"

P -1 -f /tmp/rollback.sql
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "$DEFS" > "$TMPD/defs-rollback.txt"
diff "$TMPD/defs-antes.txt" "$TMPD/defs-rollback.txt" || { echo "rollback não devolveu as funções anteriores"; exit 1; }
P -1 -f /tmp/0195.sql   # volta depois do rollback
Q -c "$DEFS" > "$TMPD/defs-volta.txt"
diff "$TMPD/defs-0195.txt" "$TMPD/defs-volta.txt" || { echo "a 0195 depois do rollback ficou diferente"; exit 1; }
echo "RECEITA PRT SQL OK"
