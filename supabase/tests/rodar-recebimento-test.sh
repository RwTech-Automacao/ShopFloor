#!/usr/bin/env bash
# Testes SQL do Recebimento (0124/0125/0127/0142/0143/0144/0147 e o dashboard da 0152) num Postgres descartável.
# Uso: supabase/tests/rodar-recebimento-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-recebimento-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker cp supabase/migrations/0124_recebimento_fluxo_registros.sql "$NOME":/tmp/0124.sql
docker cp supabase/migrations/0125_recebimento_fluxo_historico.sql "$NOME":/tmp/0125.sql
docker cp supabase/migrations/0127_recebimento_caixa_divergencia.sql "$NOME":/tmp/0127.sql
docker cp supabase/migrations/0142_divergencia_justificativa.sql "$NOME":/tmp/0142.sql
docker cp supabase/migrations/0143_rec_justificar_divergencia.sql "$NOME":/tmp/0143.sql
docker cp supabase/migrations/0144_rec_fluxo_itens_justificativa.sql "$NOME":/tmp/0144.sql
docker cp supabase/migrations/0147_divergencia_num.sql "$NOME":/tmp/0147.sql
docker cp supabase/tests/recebimento_fluxo_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql

# Idempotência: o usuário reaplica migração quando fica na dúvida, então rodar as migrações duas
# vezes na mesma base não pode falhar nem mudar o resultado.
# A 0144 mudou o tipo de retorno de rec_fluxo_emb_itens; a 0124 e a 0127 (mais velhas) não sabem disso e o
# `create or replace` delas não voltam atrás. Reaplicar as duas SOBRE a 0144 exige derrubar antes — e a
# 0144 reaplicada logo abaixo restaura o estado final.
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -c "drop function if exists public.rec_fluxo_emb_itens(text, text, int)"
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0124.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0125.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0127.sql
# 0142, 0143, 0144 e 0147: primeira aplicação e depois a segunda (idempotência).
for _ in 1 2; do
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0142.sql
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0143.sql
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0144.sql
  docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/0147.sql
done
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select count(*) from information_schema.columns where table_schema='public' and table_name='processos_recebimento' and column_name in ('divergencia_justificativa','divergencia_justificada_por','divergencia_justificada_em','divergencia_justificada_por_nome')" | grep -qx 4 \
  && echo "colunas da 0142 (4): ok" || { echo "colunas da 0142 FALTAM"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select count(*) from pg_proc where proname='rec_justificar_divergencia' and pronamespace='public'::regnamespace" | grep -qx 1 \
  && echo "função da 0143: ok" || { echo "função da 0143 FALTA"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select count(*) from information_schema.columns where table_schema='public' and table_name='processos_recebimento' and column_name='divergencia_num' and is_generated='ALWAYS'" | grep -qx 1 \
  && echo "coluna gerada da 0147: ok" || { echo "coluna gerada da 0147 FALTA"; exit 1; }
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq \
  -c "select set_config('teste.perms','recebimento.visualizar',false)" \
  -c "select sum(itens) from rec_fluxo_emb('EMB390')" | tail -1 | grep -qx 9 \
  && echo "idempotência da 0124/0125/0127/0142/0143/0144/0147: ok" \
  || { echo "idempotência da 0124/0125/0127/0142/0143/0144/0147 FALHOU"; exit 1; }

# ---------- Dashboard (0152) num banco PRÓPRIO ----------
# O dashboard conta a TABELA INTEIRA: a massa do recebimento_fluxo_test.sql mudaria todos os totais.
# Ordem: esquema → 0142/0143/0147 → massa (com justificativa só de espaços, ANTES da 0152, para a
# normalização ter o que normalizar) → 0152 DUAS vezes (idempotência; -1 = cada aplicação numa
# transação, como no SQL Editor) → teste.
docker cp supabase/migrations/0152_rec_dashboard.sql "$NOME":/tmp/0152.sql
docker cp supabase/tests/recebimento_dashboard_esquema.sql "$NOME":/tmp/dash_esquema.sql
docker cp supabase/tests/recebimento_dashboard_massa.sql "$NOME":/tmp/dash_massa.sql
docker cp supabase/tests/recebimento_dashboard_test.sql "$NOME":/tmp/dash_teste.sql
docker exec "$NOME" createdb -U postgres dashboard
docker exec "$NOME" psql -U postgres -d dashboard -v ON_ERROR_STOP=1 -q -f /tmp/dash_esquema.sql
for m in 0142 0143 0147; do
  docker exec "$NOME" psql -U postgres -d dashboard -1 -v ON_ERROR_STOP=1 -q -f "/tmp/$m.sql"
done
docker exec "$NOME" psql -U postgres -d dashboard -v ON_ERROR_STOP=1 -q -f /tmp/dash_massa.sql
for _ in 1 2; do
  docker exec "$NOME" psql -U postgres -d dashboard -1 -v ON_ERROR_STOP=1 -q -f /tmp/0152.sql
done
docker exec "$NOME" psql -U postgres -d dashboard -v ON_ERROR_STOP=1 -q -f /tmp/dash_teste.sql

# ---------- Métricas do dashboard (0154) num banco PRÓPRIO (dashmet) ----------
# Mesmo motivo do `dashboard`: a função conta a tabela inteira. Ordem: esquema (com os campos extras e
# a tabela logs) → 0142/0143/0147 → 0152 → massa → 0154 DUAS vezes (idempotência; -1 = uma transação
# por aplicação, como no SQL Editor) → teste.
docker cp supabase/migrations/0154_rec_dashboard_metricas.sql "$NOME":/tmp/0154.sql
docker cp supabase/tests/recebimento_dashboard_metricas_esquema.sql "$NOME":/tmp/dashmet_esquema.sql
docker cp supabase/tests/recebimento_dashboard_metricas_massa.sql "$NOME":/tmp/dashmet_massa.sql
docker cp supabase/tests/recebimento_dashboard_metricas_test.sql "$NOME":/tmp/dashmet_teste.sql
docker exec "$NOME" createdb -U postgres dashmet
docker exec "$NOME" psql -U postgres -d dashmet -v ON_ERROR_STOP=1 -q -f /tmp/dashmet_esquema.sql
for m in 0142 0143 0147 0152; do
  docker exec "$NOME" psql -U postgres -d dashmet -1 -v ON_ERROR_STOP=1 -q -f "/tmp/$m.sql"
done
docker exec "$NOME" psql -U postgres -d dashmet -v ON_ERROR_STOP=1 -q -f /tmp/dashmet_massa.sql
for _ in 1 2; do
  docker exec "$NOME" psql -U postgres -d dashmet -1 -v ON_ERROR_STOP=1 -q -f /tmp/0154.sql
done
docker exec "$NOME" psql -U postgres -d dashmet -v ON_ERROR_STOP=1 -q -f /tmp/dashmet_teste.sql
