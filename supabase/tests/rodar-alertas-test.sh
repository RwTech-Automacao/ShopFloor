#!/usr/bin/env bash
# Testes SQL dos alertas num Postgres descartável (Docker). Uso: supabase/tests/rodar-alertas-test.sh
#
# A 0113 é aplicada com `psql -1 -v ON_ERROR_STOP=1 -f`, exatamente como roda no RDS — assim o
# teste também garante que a migração passa inteira como transação única. A 0114 usa `create index
# concurrently`, que não roda dentro de transação nenhuma (nem com -1), então vai à parte, sem -1.
# Depois dos testes da 0113, a 0115 (tipos de regra) é aplicada POR CIMA, com -1 e DUAS VEZES
# (prova que é idempotente e que migra dados de verdade da 0113), e roda alertas_tipos_test.sql.
# Mesma receita para a 0122 (reabertura) e a 0123 (canal do Discord), cada uma por cima de tudo,
# com alertas_reabertura_test.sql e alertas_canal_test.sql. Depois a 0136 (PMO/OP e posições), com
# alertas_op_posicoes_test.sql, a 0137 (explicação de quem resolve) com alertas_explicacao_test.sql
# a 0139 (janela por blocos de turno) com alertas_intervalos_test.sql e, fechando a fila, a 0141
# (resumo diário por posto) com alertas_resumo_test.sql — aplicada TRÊS vezes, e é o teste dela que
# prova a guarda contra reenvio (o relatório não pode sair duas vezes no dia).
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-alertas-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done

docker cp supabase/tests/_stubs.sql "$NOME":/tmp/_stubs.sql
docker cp supabase/migrations/0113_alertas.sql "$NOME":/tmp/0113.sql
docker cp supabase/migrations/0114_sf_registros_posto_data_idx.sql "$NOME":/tmp/0114.sql
docker cp supabase/tests/alertas_test.sql "$NOME":/tmp/teste.sql

docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/_stubs.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0113.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0114.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
# ---------- Concorrência: a trava do alerta_avaliar ----------
# A sessão 1 roda alerta_avaliar dentro de uma transação e segura com pg_sleep; a sessão 2 começa
# ~1 s depois. Sem pg_try_advisory_xact_lock as duas avaliariam ao mesmo tempo e o mesmo posto
# viraria dois alertas (ou um erro de índice único).
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
sessao() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -qtA; }

set +e
sessao >"$TMPD/s1.out" 2>"$TMPD/s1.err" <<'SQL' &
set role service_role;
begin;
select alerta_avaliar()->>'ocupado';
select pg_sleep(3);
commit;
SQL
P1=$!
sleep 1
OCUPADO=$(sessao 2>"$TMPD/s2.err" <<'SQL'
set role service_role;
select alerta_avaliar()->>'ocupado';
SQL
)
wait "$P1"
set -e

if [ "$(tr -d '[:space:]' <<<"$OCUPADO")" = "true" ]; then
  echo "trava do alerta_avaliar: ok"
else
  echo "trava do alerta_avaliar FALHOU: ocupado='$OCUPADO'"
  cat "$TMPD/s1.err" "$TMPD/s2.err"
  exit 1
fi

# ---------- Concorrência: a trava do alerta_vincular por (canal, externo_id) ----------
# Sem pg_advisory_xact_lock, duas chamadas simultâneas do mesmo (canal, externo_id) contariam as
# falhas ao mesmo tempo e passariam juntas do limite de 5. Com a trava, a sessão 2 ESPERA a 1
# terminar: enquanto a 1 dorme, a sessão 3 tem que ver um advisory lock NÃO concedido (a 2 na fila),
# e no fim as duas falhas estão gravadas.
set +e
sessao >"$TMPD/v1.out" 2>"$TMPD/v1.err" <<'SQL' &
set role service_role;
begin;
select alerta_vincular('ALERTA-ZZZZ', 'telegram', 'LK1')->>'erro';
select pg_sleep(4);
commit;
SQL
V1=$!
sleep 1
sessao >"$TMPD/v2.out" 2>"$TMPD/v2.err" <<'SQL' &
set role service_role;
select alerta_vincular('ALERTA-ZZZZ', 'telegram', 'LK1')->>'erro';
SQL
V2=$!
sleep 1
ESPERANDO=$(sessao 2>"$TMPD/v3.err" <<'SQL'
select count(*) from pg_locks where locktype = 'advisory' and not granted;
SQL
)
wait "$V1"; wait "$V2"
TENTATIVAS=$(sessao 2>>"$TMPD/v3.err" <<'SQL'
select count(*) from alerta_tentativas where canal = 'telegram' and externo_id = 'LK1';
SQL
)
set -e

if [ "$(tr -d '[:space:]' <<<"$ESPERANDO")" = "1" ] && [ "$(tr -d '[:space:]' <<<"$TENTATIVAS")" = "2" ]; then
  echo "trava do alerta_vincular: ok"
else
  echo "trava do alerta_vincular FALHOU: esperando='$ESPERANDO' tentativas='$TENTATIVAS'"
  cat "$TMPD/v1.err" "$TMPD/v2.err" "$TMPD/v3.err"
  exit 1
fi

# ---------- Concorrência: a reserva da fila (alerta_reservar_envios) ----------
# Três linhas pendentes. A sessão 1 reserva dentro de uma transação e segura com pg_sleep (as
# linhas ficam travadas, sem commit). A sessão 2 reserva ~1 s depois com lock_timeout de 500 ms:
# com `for update skip locked` ela NÃO espera e NÃO pega nada. Se esperasse, estouraria o
# lock_timeout; se pegasse, a mesma mensagem sairia duas vezes.
sessao >/dev/null 2>"$TMPD/f0.err" <<'SQL'
update alerta_envios set tentativas = 3 where not ok;
insert into alerta_envios (usuario_id, canal, tipo, dados)
select '00000000-0000-0000-0000-000000000001', 'telegram', 'resolvido', jsonb_build_object('posto', 'Conc' || g)
  from generate_series(1, 3) g;
SQL
set +e
sessao >"$TMPD/f1.out" 2>"$TMPD/f1.err" <<'SQL' &
set role service_role;
begin;
select count(*) from alerta_reservar_envios(array['telegram', 'discord'], 100);
select pg_sleep(3);
commit;
SQL
F1=$!
sleep 1
F2=$(sessao 2>"$TMPD/f2.err" <<'SQL'
set role service_role;
set lock_timeout = '500ms';
select count(*) from alerta_reservar_envios(array['telegram', 'discord'], 100);
SQL
)
wait "$F1"
F3=$(sessao 2>>"$TMPD/f2.err" <<'SQL'
select count(*) from alerta_envios where dados->>'posto' like 'Conc%' and tentativas = 1;
SQL
)
set -e

if [ "$(head -n1 "$TMPD/f1.out" | tr -d '[:space:]')" = "3" ] && [ "$(tr -d '[:space:]' <<<"$F2")" = "0" ] \
   && [ "$(tr -d '[:space:]' <<<"$F3")" = "3" ]; then
  echo "reserva concorrente da fila: ok"
else
  echo "reserva concorrente da fila FALHOU: s1='$(cat "$TMPD/f1.out")' s2='$F2' tentativas1='$F3'"
  cat "$TMPD/f0.err" "$TMPD/f1.err" "$TMPD/f2.err"
  exit 1
fi

# ---------- 0115: tipos de regra, destinatários do ShopFloor, filtro de PMO ----------
docker cp supabase/migrations/0115_alertas_tipos.sql "$NOME":/tmp/0115.sql
docker cp supabase/tests/alertas_tipos_test.sql "$NOME":/tmp/teste_tipos.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0115.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0115.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_tipos.sql
echo "0115 (tipos de regra): ok"

# ---------- 0122: reabrir ocorrência resolvida que continua fora do limite ----------
docker cp supabase/migrations/0122_alertas_reabertura.sql "$NOME":/tmp/0122.sql
docker cp supabase/tests/alertas_reabertura_test.sql "$NOME":/tmp/teste_reabertura.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0122.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0122.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_reabertura.sql
echo "0122 (reabertura): ok"

# ---------- 0123: avisar num canal do Discord ----------
docker cp supabase/migrations/0123_alertas_canal.sql "$NOME":/tmp/0123.sql
docker cp supabase/tests/alertas_canal_test.sql "$NOME":/tmp/teste_canal.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0123.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0123.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_canal.sql
echo "0123 (canal do Discord): ok"

# ---------- 0136: PMO/OP em todo alerta + posições no alerta de defeito ----------
docker cp supabase/migrations/0136_alertas_op_e_posicoes.sql "$NOME":/tmp/0136.sql
docker cp supabase/tests/alertas_op_posicoes_test.sql "$NOME":/tmp/teste_op.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0136.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0136.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_op.sql
echo "0136 (OP e posições): ok"

# ---------- 0137: quem resolve o alerta diz o que fez ----------
docker cp supabase/migrations/0137_alertas_explicacao.sql "$NOME":/tmp/0137.sql
docker cp supabase/tests/alertas_explicacao_test.sql "$NOME":/tmp/teste_expl.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0137.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0137.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_expl.sql
echo "0137 (explicação ao resolver): ok"

# ---------- 0139: janela por blocos de turno ('intervalos') ----------
# Fecha a fila: é a última migração dos alertas. O teste dela depende de a 0139 já ter trocado as
# assinaturas (alerta_taxas de 4 -> 6 parâmetros, alerta_avaliar de 1 -> 2), então vem DEPOIS do
# teste da 0136 — que cita a assinatura de 4 de propósito, para conferir o que valia naquele ponto.
docker cp supabase/migrations/0139_alertas_intervalos.sql "$NOME":/tmp/0139.sql
docker cp supabase/tests/alertas_intervalos_test.sql "$NOME":/tmp/teste_interv.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0139.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0139.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_interv.sql
echo "0139 (janela por blocos de turno): ok"

# ---------- 0141: resumo diário por posto ('resumo') ----------
# Fecha a fila. Recria o alerta_avaliar (3º parâmetro, p_resumos) e DERRUBA a assinatura de 2: por isso
# vem DEPOIS do teste da 0139, que ainda fala da assinatura de 2 (e foi escrito para valer nas duas).
# Três aplicações seguidas, cada uma como transação única (-1), provam a idempotência e a ordem dos
# checks (o novo entra antes de o antigo cair).
docker cp supabase/migrations/0141_alertas_resumo_diario.sql "$NOME":/tmp/0141.sql
docker cp supabase/tests/alertas_resumo_test.sql "$NOME":/tmp/teste_resumo.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0141.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0141.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0141.sql   # e mais uma, por paranoia
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_resumo.sql
echo "0141 (resumo diário): ok"

# ---------- 0149: módulo da regra (Alertas do Recebimento) ----------
# Duas aplicações seguidas, cada uma como transação única (-1), provam a idempotência e a ordem dos
# checks. Vem DEPOIS do teste do resumo: a 0149 recria o alerta_avaliar sobre o corpo da 0141.
docker cp supabase/migrations/0149_alertas_modulo.sql "$NOME":/tmp/0149.sql
docker cp supabase/tests/alertas_modulo_test.sql "$NOME":/tmp/teste_modulo.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0149.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0149.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_modulo.sql
echo "0149 (módulo da regra): ok"

# ---------- 0150: tipo de regra 'emb' (aviso de fim de EMB) ----------
# Recria o alerta_avaliar sobre o corpo da 0149, com um QUINTO ramo no cursor e um bloco próprio no
# topo do laço. É o teste dela que prova a marca de "já avisei" (o aviso não pode sair duas vezes)
# e o piso criado_em (a primeira rodada não pode avisar toda EMB histórica).
#
# Antes dela, DUAS preparações que não são da migração:
#
# (1) A 0124 do Recebimento, pelas funções `rec_etapa_por_status` e `rec_divergente` — o gatilho e o
#     conteúdo da 0150 as chamam, e o teste tem de medir as de VERDADE (se o terminal mudar lá, o
#     aviso de EMB muda aqui). As tabelas que ela lê estão no _stubs.sql; `public.logs` não precisa
#     de stub porque só funções plpgsql dela a leem, e plpgsql não planeja o corpo na criação.
#     Duas aplicações: a 0124 é idempotente (só `create or replace function` + grants).
#
# (2) A linha 'REC modulo' sai da base. Ela é massa do alertas_modulo_test.sql, que a inseriu À
#     FORÇA com o check `alerta_regras_modulo_tipo` derrubado (é tipo 'aprovacao' no módulo
#     'recebimento', combinação que nenhum caminho do app produz). A 0150 reescreve esse check para
#     `recebimento -> tipo in ('emb')` e o `add constraint` VALIDA as linhas que já existem, então
#     essa linha forçada derrubaria a migração aqui — e só aqui: em produção não existe nenhuma
#     regra de 'recebimento' (a 0149 nem subiu ainda). Apagar é o certo; relaxar o check para
#     `not valid` enfraqueceria produção para acomodar massa de teste.
#     As ocorrências dela saem antes: o T7 do alertas_modulo_test.sql avaliou a regra e abriu uma,
#     e a FK alerta_ocorrencias_regra_id_fkey é `on delete restrict` (os envios dessa ocorrência
#     caem em cascata, pela FK da 0113).
docker cp supabase/migrations/0124_recebimento_fluxo_registros.sql "$NOME":/tmp/0124.sql
docker cp supabase/migrations/0150_alertas_fim_de_emb.sql "$NOME":/tmp/0150.sql
docker cp supabase/tests/alertas_emb_test.sql "$NOME":/tmp/teste_emb.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0124.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0124.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q \
  -c "delete from public.alerta_ocorrencias where regra_id in (select id from public.alerta_regras where nome = 'REC modulo')" \
  -c "delete from public.alerta_regras where nome = 'REC modulo'"
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0150.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0150.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_emb.sql

# ---------- teto de idade de 3 dias do fim de EMB: apos a 0150 E apos a 0151 ----------
# Em producao a funcao viva e a da 0151, entao a copia do teto la tambem precisa de prova. Cada
# passada troca @P@ por um sufixo proprio e se limpa. TETO_RUN_AB / TETO_RUN_C (1/0) deixam rodar
# um caso so (usado para provar que cada um tem dentes sozinho).
docker cp supabase/tests/alertas_emb_teto_test.sql "$NOME":/tmp/teto_base.sql
teto_passada() {
  docker exec "$NOME" sh -c "sed 's/@P@/$1/g' /tmp/teto_base.sql > /tmp/teto_$1.sql"
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -v run_ab="${TETO_RUN_AB:-1}" -v run_c="${TETO_RUN_C:-1}" -f /tmp/teto_$1.sql
}
teto_passada pos0150
echo "0150 (fim de EMB): ok"

# ---------- 0151: canal 'email' ----------
# O e-mail é o único canal sem vínculo: o endereço sai de usuarios.email. É o teste dela que prova
# que a reserva acha esse endereço — sem isso a linha ficaria pendente e expiraria em silêncio.
docker cp supabase/migrations/0151_alertas_canal_email.sql "$NOME":/tmp/0151.sql
docker cp supabase/tests/alertas_email_test.sql "$NOME":/tmp/teste_email.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0151.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0151.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_email.sql
echo "0151 (canal email): ok"
teto_passada pos0151
echo "teto de 3 dias pos-0151: ok"

# ---------- 0167: tipo de regra 'parado' (placas paradas antes do Almoxarifado) ----------
# Recria o alerta_avaliar sobre o corpo da 0151 com um SEXTO ramo e um 4º parâmetro (p_parados), e
# DERRUBA a assinatura de 3: por isso vem depois de tudo. Esta base não tem as tabelas sf_* do
# Almoxarifado (só o _stubs.sql): a sf_almox_pendencias_base e a casca são plpgsql e só resolvem as
# tabelas quando rodam, então a 0167 inteira aplica aqui sem elas — e é isso que se prova (a parte
# das pendências é medida no rodar-almoxarifado-test.sh). Duas aplicações, cada uma como transação
# única (-1): idempotência e a ordem do drop da assinatura antiga.
docker cp supabase/migrations/0167_alerta_almox_parado.sql "$NOME":/tmp/0167.sql
docker cp supabase/tests/alertas_parado_test.sql "$NOME":/tmp/teste_parado.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0167.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0167.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_parado.sql
echo "0167 (parado no Almoxarifado): ok"

# ---------- 0170: tipo de regra 'compels' (problemas no envio ao Compels) ----------
# Mesmo molde da 0167: recria o alerta_avaliar (mesma assinatura de 4 parâmetros, create or replace) com
# dois ramos novos no cursor. Esta base não tem a fila do Compels (só o _stubs.sql): o esquema mínimo
# dela entra ANTES, com linhas "legadas" que provam o backfill de erro_esperado. Duas aplicações, cada
# uma como transação única (-1): idempotência, inclusive a do backfill e a dos checks.
docker cp supabase/migrations/0170_alerta_problemas_compels.sql "$NOME":/tmp/0170.sql
docker cp supabase/tests/alertas_compels_esquema.sql "$NOME":/tmp/esquema_compels.sql
docker cp supabase/tests/alertas_compels_test.sql "$NOME":/tmp/teste_compels.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema_compels.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0170.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0170.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_compels.sql
echo "0170 (problemas no envio ao Compels): ok"

# ---------- 0172: "parado ou travado na produção" (reescreve o tipo de regra 'parado') ----------
# Mesmo molde: create or replace do alerta_avaliar (4 parâmetros), partindo do corpo da 0170. O esquema mínimo do
# chão de fábrica entra ANTES (a função de leitura é SQL e o Postgres confere as colunas na criação). Antes
# da primeira aplicação entra uma regra 'parado' ANTIGA (ativa, do tempo do Almoxarifado): a migração a converte
# (desativa, defaults nas colunas novas) UMA vez — na segunda aplicação, uma regra reativada à mão NÃO é desativada
# de novo (a guarda é a coluna nova ainda não existir).
docker cp supabase/migrations/0172_alerta_parado_travado.sql "$NOME":/tmp/0172.sql
docker cp supabase/tests/alertas_travados_esquema.sql "$NOME":/tmp/esquema_travados.sql
docker cp supabase/tests/alertas_travados_test.sql "$NOME":/tmp/teste_travados.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema_travados.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "
  insert into public.alerta_regras (nome, tipo, modulo, postos, janela_tipo, minimo_bipes, limite_horas, canais, destinatarios, ativa, criado_por)
  values ('Parado ANTIGA', 'parado', 'shopfloor', array['ALMOX'], 'op', null, 2, array['telegram'],
          array['00000000-0000-0000-0000-0000000000c1']::uuid[], true, '00000000-0000-0000-0000-000000000001')"
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0172.sql
CONV=$(docker exec "$NOME" psql -U postgres -qtA -c "select ativa::text || '/' || so_ops_ativas::text || '/' || incluir_manutencao::text || '/' || limite_horas::text from public.alerta_regras where nome = 'Parado ANTIGA'")
if [ "$CONV" != "false/true/true/2" ]; then echo "0172 conversao da regra antiga FALHOU: [$CONV]"; exit 1; fi
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "update public.alerta_regras set ativa = true where nome = 'Parado ANTIGA'"
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0172.sql   # de novo: idempotente
CONV2=$(docker exec "$NOME" psql -U postgres -qtA -c "select ativa::text from public.alerta_regras where nome = 'Parado ANTIGA'")
if [ "$CONV2" != "true" ]; then echo "0172 NAO e idempotente: a segunda aplicacao desativou a regra reativada [$CONV2]"; exit 1; fi
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "update public.alerta_regras set ativa = false where nome = 'Parado ANTIGA'"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_travados.sql
echo "0172 (parado ou travado na produção): ok"

# ---------- 0173: ficha de apontamento (tipo de regra 'ficha') ----------
# Mesmo molde: create or replace do alerta_avaliar (4 parâmetros), partindo do corpo da 0172, só com ACRÉSCIMOS.
# PROVA no próprio runner: o corpo da alerta_avaliar da 0173, comparado com o da 0172, não pode ter NENHUMA linha
# removida ou alterada (diff: só linhas '>'). O esquema mínimo do chão de fábrica (com as funções-base do
# Almoxarifado como stubs) entra ANTES; duas aplicações, cada uma como transação única (-1): idempotência.
corpo() { awk 'index($0,"create or replace function public.alerta_avaliar(")==1{p=1} p{print} p&&$0=="$func$;"{exit}' "$1"; }
M0173="${FICHA_MIGRACAO:-supabase/migrations/0173_alerta_ficha_apontamento.sql}"   # FICHA_MIGRACAO: so para o teste de mutantes
REMOVIDAS=$(diff <(corpo supabase/migrations/0172_alerta_parado_travado.sql) <(corpo "$M0173") | grep -c '^<' || true)
if [ "$REMOVIDAS" != "0" ]; then echo "0173 alterou/removeu $REMOVIDAS linha(s) da alerta_avaliar da 0172 (so acrescimos sao permitidos)"; exit 1; fi
echo "0173: alerta_avaliar so com acrescimos sobre a 0172 (0 linhas removidas): ok"
docker cp "$M0173" "$NOME":/tmp/0173.sql
docker cp supabase/tests/alertas_ficha_esquema.sql "$NOME":/tmp/esquema_ficha.sql
docker cp supabase/tests/alertas_ficha_test.sql "$NOME":/tmp/teste_ficha.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/esquema_ficha.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0173.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0173.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_ficha.sql
# Os dois scripts de leitura do roteiro (medição e simulação) têm de RODAR (sintaxe e nomes de coluna certos).
docker cp docs/operacao/alerta-ficha/01-medir.sql "$NOME":/tmp/ficha_medir.sql
docker cp docs/operacao/alerta-ficha/02-simulacao.sql "$NOME":/tmp/ficha_simulacao.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/ficha_medir.sql >/dev/null
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/ficha_simulacao.sql >/dev/null
echo "0173 (ficha de apontamento): ok"

# ---------- 0177: relatório "Peças paradas" (alerta_travados_sns + leituras da tela) ----------
# A 0177 reescreve a alerta_travados como agrupamento da alerta_travados_sns. PROVA: uma FOTO da alerta_travados
# da 0172 é tirada ANTES (na massa que o alertas_travados_test.sql deixou), e o teste exige saída idêntica depois.
# Duas aplicações, cada uma como transação única (-1): idempotência.
docker cp supabase/migrations/0177_alerta_parados_relatorio.sql "$NOME":/tmp/0177.sql
docker cp supabase/tests/alertas_parados_relatorio_foto.sql "$NOME":/tmp/foto_parados_relatorio.sql
docker cp supabase/tests/alertas_parados_relatorio_test.sql "$NOME":/tmp/teste_parados_relatorio.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/foto_parados_relatorio.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0177.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0177.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_parados_relatorio.sql
echo "0177 (relatório de peças paradas): ok"

# ---------- 0178: relatório de uma EMB (rec_emb_relatorio sobre a rec_emb_divergencias da 0150) ----------
docker cp supabase/migrations/0178_rec_emb_relatorio.sql "$NOME":/tmp/0178.sql
docker cp supabase/tests/rec_emb_relatorio_test.sql "$NOME":/tmp/teste_emb_relatorio.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0178.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0178.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_emb_relatorio.sql
echo "0178 (relatório de uma EMB): ok"

# ---------- 0179: lista das regras "parado" para o seletor da aba "Peças paradas" ----------
docker cp supabase/migrations/0179_alerta_parado_regras_lista.sql "$NOME":/tmp/0179.sql
docker cp supabase/tests/alertas_parado_regras_lista_test.sql "$NOME":/tmp/teste_parado_regras_lista.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0179.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0179.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_parado_regras_lista.sql
echo "0179 (lista das regras parado): ok"

# ---------- 0180: tela "Peças paradas" sem regra (sf_pecas_paradas) ----------
docker cp supabase/migrations/0180_sf_pecas_paradas.sql "$NOME":/tmp/0180.sql
docker cp supabase/tests/sf_pecas_paradas_test.sql "$NOME":/tmp/teste_pecas_paradas.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0180.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0180.sql   # de novo: idempotente
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste_pecas_paradas.sql
echo "0180 (peças paradas sem regra): ok"

echo "ALERTAS SQL OK"
