#!/usr/bin/env bash
# Teste SQL da 0181 (faixas de Nº de Série por OP) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-faixas-sn-test.sh
# A 0181 é aplicada DUAS vezes (idempotência) dentro do faixas_sn_test.sql, por cima das migrações reais
# do Setup (0111/0112) e da sf_sn_na_faixa real da 0129 (extraída do arquivo). Depois, o diff que prova
# que as três funções copiadas só mudaram nas linhas marcadas "0181". A entrada do Almoxarifado com duas
# faixas roda na suíte do Almoxarifado (PLACAS=1 supabase/tests/rodar-almoxarifado-test.sh), que já monta
# a 0175 vigente.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-faixas-sn-test
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
docker cp supabase/migrations/0111_setup_tabelas.sql "$NOME":/tmp/0111.sql
docker cp supabase/migrations/0112_setup_funcoes.sql "$NOME":/tmp/0112.sql
docker cp supabase/migrations/0181_sf_ordem_faixas.sql "$NOME":/tmp/0181.sql
docker cp supabase/tests/faixas_sn_test.sql "$NOME":/tmp/teste.sql
docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q -f /tmp/teste.sql
bash supabase/tests/faixas_sn_diff.sh
echo "FAIXAS SN OK"
