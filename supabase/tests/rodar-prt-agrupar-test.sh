#!/usr/bin/env bash
# Testes SQL da 0197 (apontamento automático das PRTs no Compels: só OPs novas, envio por GRUPO) num Postgres descartável.
# Uso: supabase/tests/rodar-prt-agrupar-test.sh
# Monta o esquema mínimo da 0184 (estrutura_op_esquema.sql) + o da Integração (receita_prt_esquema.sql), a reserva REAL da
# 0132 e a soma da 0153 (as funções que a 0197 redefine), a 0184, a 0194, a 0066, a sf_cancelar_lancamento da 0165 e a
# 0195 — o estado vigente. Depois a massa de ANTES (uma OP com PRT já na fila), a 0197 DUAS vezes (idempotência), a prova
# (prt_agrupar_test.sql), a reaplicação da 0197 por cima de OPs novas (não pode desligá-las), a corrida de duas rodadas
# do agrupar, o rollback (duas vezes; devolve as funções ao texto anterior byte a byte) e a 0197 de novo.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-prt-agrupar-test
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
extrai "create or replace function public.sf_sn_na_faixa(" supabase/migrations/0129_sf_almoxarifado_entrada.sql 'end $func$;' "$TMPD/sf_sn_na_faixa.sql"
extrai "create or replace function public.sf_cancelar_lancamento(" supabase/migrations/0165_placas_almoxarifado.sql '$func$;' "$TMPD/cancelar.sql"
extrai "create or replace function public.sf_estoque_reservar(" supabase/migrations/0132_sf_estoque_envios.sql '$func$;' "$TMPD/reservar.sql"
for F in sf_sn_na_faixa cancelar reservar; do docker cp "$TMPD/$F.sql" "$NOME":/tmp/$F.sql; done
docker cp supabase/tests/estrutura_op_esquema.sql "$NOME":/tmp/esquema.sql
docker cp supabase/tests/receita_prt_esquema.sql "$NOME":/tmp/esquema-integracao.sql
docker cp supabase/migrations/0153_sf_estoque_enviado.sql "$NOME":/tmp/0153.sql
docker cp supabase/migrations/0184_estrutura_op.sql "$NOME":/tmp/0184.sql
docker cp supabase/migrations/0194_editar_op_trechos.sql "$NOME":/tmp/0194.sql
docker cp supabase/migrations/0066_sf_integracoes_por_posto.sql "$NOME":/tmp/0066.sql
docker cp supabase/migrations/0195_receita_integracao_prt.sql "$NOME":/tmp/0195.sql
docker cp supabase/migrations/0197_prt_apontamento_automatico.sql "$NOME":/tmp/0197.sql
docker cp supabase/tests/prt_agrupar_antes.sql "$NOME":/tmp/antes.sql
docker cp supabase/tests/prt_agrupar_test.sql "$NOME":/tmp/teste.sql
docker cp docs/operacao/estrutura-op/rollback-0197.sql "$NOME":/tmp/rollback.sql
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
DEFS="select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('sf_trecho_enfileirar','sf_trecho_desfazer','sf_estoque_reservar','sf_estoque_enviado','sf_resumo_trechos_op','sf_ordem_regravar_trechos')"
Q -c "$DEFS" > "$TMPD/defs-antes.txt"

P -f /tmp/antes.sql
P -1 -f /tmp/0197.sql
P -1 -f /tmp/0197.sql   # idempotente
Q -c "$DEFS" > "$TMPD/defs-0197.txt"
cmp -s "$TMPD/defs-antes.txt" "$TMPD/defs-0197.txt" && { echo "a 0197 não mudou as funções"; exit 1; }
P -f /tmp/teste.sql

# ---------- reaplicar a 0197 não desliga as OPs novas nem cancela nada ----------
CONTA="select count(*) filter (where cancelado_em is not null) || '/' || count(*) from sf_estoque_envios"
ANTES=$(Q -c "$CONTA")
P -1 -f /tmp/0197.sql
Q -c "select string_agg(pmo || '=' || apontar_prt, ',' order by pmo) from sf_ordens where pmo like 'PMON%' or pmo = 'PMOANTIGA'" \
  | grep -qx 'PMOANTIGA=false,PMON1=true,PMON2=true,PMON3=true,PMON4=true' || { echo "reaplicar a 0197 mexeu no apontar_prt"; exit 1; }
[ "$(Q -c "$CONTA")" = "$ANTES" ] || { echo "reaplicar a 0197 cancelou linha"; exit 1; }
echo "reaplicar a 0197: ok"

# ---------- a corrida: duas rodadas do agrupar ao mesmo tempo não criam dois grupos ----------
P -c "select sf_cadastrar_op('{\"ordem\":{\"pmo\":\"PMON5\",\"op\":\"9641\",\"cliente\":\"C\",\"qtd\":2},\"trechos\":[{\"seq\":1,\"codigo\":\"PRTN5S\",\"tipo\":\"prt\",\"compels_op\":\"9642\",\"postos\":[\"SPI\",\"Inspeção AOI TOP\"],\"faixas\":[]},{\"seq\":2,\"codigo\":\"PMON5\",\"tipo\":\"pmo\",\"compels_op\":\"9641\",\"postos\":[\"Teste\",\"Almoxarifado\"],\"faixas\":[{\"sn_ini\":\"1\",\"sn_fim\":\"5\"}]}]}'::jsonb)" >/dev/null
P -c "insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values
  ('Inspeção AOI TOP', 'PMON5', '9641', 'Aprovado', '1', '1'), ('Inspeção AOI TOP', 'PMON5', '9641', 'Aprovado', '2', '2')"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "begin" -c "select sf_prt_agrupar()" -c "select pg_sleep(3)" -c "commit" >"$TMPD/a.out" 2>&1 &
PA=$!
sleep 1
# a segunda rodada ESPERA a primeira (trava da PRT); com lock_timeout ela não passa
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '500ms'" -c "select sf_prt_agrupar()" >/dev/null 2>"$TMPD/b.err"; then
  echo "a segunda rodada não esperou a primeira"; exit 1
fi
grep -q "lock timeout" "$TMPD/b.err" || { cat "$TMPD/b.err"; exit 1; }
# e sem lock_timeout ela espera e, depois, não cria outro grupo
Q -c "select sf_prt_agrupar()" >/dev/null
wait "$PA" || { cat "$TMPD/a.out"; exit 1; }
[ "$(Q -c "select count(*) from sf_estoque_envios where pmo = 'PRTN5S' and tipo = 'grupo_prt'")" = 1 ] || { echo "duas rodadas criaram dois grupos"; exit 1; }
# o bipe (desfazer) espera a rodada que está agrupando a mesma PRT
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "insert into sf_registros (posto, pmo, op, status, numero_serie, numero_serie_norm) values ('Inspeção AOI TOP', 'PMON5', '9641', 'Aprovado', '3', '3')" >/dev/null
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "begin" -c "select sf_prt_agrupar()" -c "select pg_sleep(3)" -c "commit" >"$TMPD/a.out" 2>&1 &
PA=$!
sleep 1
if docker exec "$NOME" psql -U postgres -q -c "set lock_timeout = '500ms'" -c "delete from sf_registros where pmo = 'PMON5' and numero_serie_norm = '1'" >/dev/null 2>"$TMPD/c.err"; then
  echo "o cancelamento do bipe não esperou a rodada do agrupar"; exit 1
fi
grep -q "lock timeout" "$TMPD/c.err" || { cat "$TMPD/c.err"; exit 1; }
wait "$PA" || { cat "$TMPD/a.out"; exit 1; }
echo "CORRIDA OK"

# ---------- rollback ----------
# com grupo enviado/tocado ele recusa e não muda nada
if P -1 -f /tmp/rollback.sql 2>"$TMPD/rb.err"; then echo "o rollback passou com grupo enviado"; exit 1; fi
grep -q "ROLLBACK_0197_GRUPO_ENVIADO" "$TMPD/rb.err" || { cat "$TMPD/rb.err"; exit 1; }
Q -c "$DEFS" | cmp -s - "$TMPD/defs-0197.txt" || { echo "o rollback recusado mexeu nas funções"; exit 1; }
# (só no teste) some com os grupos enviados/tocados; os intocados o rollback desfaz
P -c "update sf_estoque_envios set grupo_id = null where grupo_id in (select id from sf_estoque_envios where tipo = 'grupo_prt' and cancelado_em is null and (ok or tentativas > 0 or reservado_em is not null))" \
  -c "delete from sf_estoque_envios where tipo = 'grupo_prt' and cancelado_em is null and (ok or tentativas > 0 or reservado_em is not null)"
[ "$(Q -c "select count(*) from sf_estoque_envios where tipo = 'grupo_prt' and cancelado_em is null")" != 0 ] || { echo "o teste devia deixar grupo intocado para o rollback desfazer"; exit 1; }
P -1 -f /tmp/rollback.sql
[ "$(Q -c "select count(*) from sf_estoque_envios where grupo_id is not null or (tipo = 'grupo_prt' and cancelado_em is null)")" = 0 ] || { echo "o rollback não desfez os grupos intocados"; exit 1; }
P -1 -f /tmp/rollback.sql   # rollback idempotente
Q -c "$DEFS" > "$TMPD/defs-rollback.txt"
diff "$TMPD/defs-antes.txt" "$TMPD/defs-rollback.txt" || { echo "rollback não devolveu as funções anteriores"; exit 1; }
Q -c "select count(*) from pg_proc where proname in ('sf_prt_agrupar','sf_estoque_grupo_concluir')" | grep -qx 0 || { echo "rollback não removeu as funções novas"; exit 1; }
P -1 -f /tmp/0197.sql   # volta depois do rollback
Q -c "$DEFS" > "$TMPD/defs-volta.txt"
diff "$TMPD/defs-0197.txt" "$TMPD/defs-volta.txt" || { echo "a 0197 depois do rollback ficou diferente"; exit 1; }
Q -c "select string_agg(pmo || '=' || apontar_prt, ',' order by pmo) from sf_ordens where pmo in ('PMOANTIGA','PMON1')" \
  | grep -qx 'PMOANTIGA=false,PMON1=true' || { echo "rollback + 0197 mexeu no apontar_prt"; exit 1; }
echo "PRT AGRUPAR SQL OK"
