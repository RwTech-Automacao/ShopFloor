#!/usr/bin/env bash
# Teste SQL da 0157 (aprovados de primeira do Burn-in no Fluxo) num Postgres descartável (Docker).
# Uso: supabase/tests/rodar-fluxo-burnin-test.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
NOME=pg-fluxo-burnin-test
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15-alpine >/dev/null
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
P() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
P <<'SQL'
create function public.tem_permissao(p text) returns boolean language sql stable as $f$ select true $f$;
create table public.sf_posto_perfis (chave text primary key, recurso text);
create table public.sf_postos (chave text primary key, perfil text);
create table public.sf_registros (id serial, pmo text, op text, numero_serie_norm text, posto text, status text,
  posto_retorno text, data_hora timestamptz, created_at timestamptz default now());
insert into public.sf_posto_perfis values ('burnin','burnin'),('teste','nenhum');
insert into public.sf_postos values ('Burn-in','burnin'),('Teste','teste');
-- Burn-in: 2 peças, cada uma com entrada (vazio) e saída Aprovado. Teste: 1 aprovada de primeira, 1 reprovada.
insert into public.sf_registros (pmo,op,numero_serie_norm,posto,status,data_hora) values
 ('P1','1','A','Burn-in','', now()-interval '5 h'),('P1','1','A','Burn-in','Aprovado', now()-interval '1 h'),
 ('P1','1','B','Burn-in','', now()-interval '5 h'),('P1','1','B','Burn-in','Aprovado', now()-interval '1 h'),
 ('P1','1','A','Teste','Aprovado', now()-interval '6 h'),('P1','1','B','Teste','Reprovado', now()-interval '6 h');
SQL
for f in 0094_sf_fluxo_op_datas 0157_sf_fluxo_op_burnin_primeira; do docker cp "supabase/migrations/$f.sql" "$NOME":/tmp/m.sql; P -1 -f /tmp/m.sql; [ "$f" = 0094_sf_fluxo_op_datas ] && { echo "--- antes da 0157 (deve falhar):"; P -c "select aprovados_primeira from public.sf_fluxo_op('P1','1') where posto='Burn-in'"; }; done
docker cp "supabase/migrations/0157_sf_fluxo_op_burnin_primeira.sql" "$NOME":/tmp/m.sql; P -1 -f /tmp/m.sql   # idempotência
docker cp supabase/tests/fluxo_burnin_primeira_test.sql "$NOME":/tmp/t.sql; P -f /tmp/t.sql
