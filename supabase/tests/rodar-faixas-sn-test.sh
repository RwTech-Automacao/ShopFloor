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

# ROLLBACK (docs/operacao/faixas-sn-op/rollback-0181.sql): as funções voltam a olhar só a faixa da OP, as
# novas somem, a tabela e as faixas ficam; reaplicar a 0181 devolve tudo (ida e volta).
docker cp docs/operacao/faixas-sn-op/rollback-0181.sql "$NOME":/tmp/rollback.sql
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/rollback.sql
TROCA="select set_config('teste.uid','00000000-0000-0000-0000-000000000001',false), set_config('teste.perms','setup.lancar',false);
select st_trocar_rolo((select id from st_setups where op='8682_F'), '36', 'ZSY-1', 'CAPJ41-L1R3', 'CAPJ41-L1R5', '08458001025')->>'resultado';"
ESTADO=$(docker exec "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq -c "
  select (select count(*) from pg_proc where proname in ('sf_sn_nas_faixas','sf_faixas_texto','sf_ordem_sns_fora_das_faixas','sf_ordens_faixa_principal'))
      || '/' || (select count(*) from pg_trigger where tgname like 'sf_ordens_faixa_principal%')
      || '/' || (select count(*) from sf_ordem_faixas)")
DEPOIS_RB=$(printf '%s\n' "$TROCA" | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
case "$ESTADO" in 0/0/[1-9]*) ;; *) echo "rollback FALHOU: estado $ESTADO"; exit 1 ;; esac
[ "$DEPOIS_RB" = REPROVADO ] || { echo "rollback FALHOU: faixa 2 ainda aceita ($DEPOIS_RB)"; exit 1; }
docker exec "$NOME" psql -U postgres -1 -v ON_ERROR_STOP=1 -q -f /tmp/0181.sql
DE_NOVO=$(printf '%s\n' "$TROCA" | docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -tAq | tail -1)
[ "$DE_NOVO" = APROVADO ] || { echo "0181 reaplicada depois do rollback FALHOU ($DE_NOVO)"; exit 1; }
echo "rollback da 0181 ($ESTADO: funções/triggers/faixas) e reaplicação: ok"
echo "FAIXAS SN OK"
