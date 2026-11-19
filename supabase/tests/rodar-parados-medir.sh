#!/usr/bin/env bash
# Mede a tela "Peças paradas" (sf_pecas_paradas, 0180, sobre a alerta_travados_sns da 0188) numa massa de volume
# (~850 mil registros: alertas_travados_massa.sql + parados_medir_massa.sql), num Postgres descartável (Docker).
#   bash supabase/tests/rodar-parados-medir.sh            # mede a 0188 (antes) e, se existir, a migração nova (depois)
#   PARADOS_MIGRACAO=supabase/migrations/XXXX.sql bash supabase/tests/rodar-parados-medir.sh
# Também PROVA que a migração nova devolve EXATAMENTE as mesmas linhas que a 0188 na massa (alerta_travados_sns em
# vários cortes/filtros e sf_pecas_paradas nas três situações), e mede como a tela chama: role authenticated, com a
# permissão no `teste.perms`, e a paginação de 1000 em 1000 do PostgREST (cada página roda a função de novo).
#   PARADOS_ANTES=supabase/migrations/0193_parados_desempenho.sql PARADOS_MIGRACAO=supabase/migrations/0196_....sql
#     → o "antes" passa a ser 0188/0180 + PARADOS_ANTES (ex.: a 0193 vigente), e a prova compara a nova com ela.
set -euo pipefail
cd "$(dirname "$0")/../.."
NOVA="${PARADOS_MIGRACAO:-supabase/migrations/0193_parados_desempenho.sql}"
NOME=pg-parados-medir
docker rm -f "$NOME" >/dev/null 2>&1 || true
docker run -d --name "$NOME" -e POSTGRES_PASSWORD=t postgres:15 -c shared_preload_libraries=auto_explain >/dev/null
TMPD=$(mktemp -d)
trap 'docker rm -f "$NOME" >/dev/null 2>&1 || true; rm -rf "$TMPD"' EXIT
for _ in $(seq 1 30); do docker exec "$NOME" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 1
psqlx() { docker exec -i "$NOME" psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
for F in _stubs alertas_travados_esquema alertas_ficha_esquema parados_posto_pendente_esquema parados_prt_fim_esquema alertas_travados_massa parados_medir_massa; do
  docker cp "supabase/tests/$F.sql" "$NOME":/tmp/$F.sql
done
docker cp supabase/migrations/0188_parados_caixa_aberta_fora_rota.sql "$NOME":/tmp/0188.sql
docker cp supabase/migrations/0180_sf_pecas_paradas.sql "$NOME":/tmp/0180.sql
psqlx -f /tmp/_stubs.sql
psqlx -f /tmp/alertas_travados_esquema.sql
psqlx -f /tmp/alertas_ficha_esquema.sql
psqlx -f /tmp/parados_posto_pendente_esquema.sql
psqlx -f /tmp/parados_prt_fim_esquema.sql   # trechos da OP + gate do perfil (0196); vazios, não mudam a 0188/0193
# Os índices de PRODUÇÃO que tocam o caminho (0028, 0058, 0091, 0095, 0100, 0160); o esquema mínimo só tem parte.
psqlx -c "create index if not exists sf_registros_sn_norm on public.sf_registros (numero_serie_norm)" \
      -c "create index if not exists sf_registros_data_hora on public.sf_registros (data_hora desc)" \
      -c "create index if not exists sf_registros_posto_data on public.sf_registros (posto, data_hora desc)" \
      -c "create index if not exists sf_registros_ordem_caixa on public.sf_registros (pmo, op, numero_caixa) where numero_caixa <> ''" \
      -c "create unique index if not exists sf_caixas_pmo_op_posto_seq_revisao_key on public.sf_caixas (pmo, op, posto, seq, revisao)"
psqlx -1 -f /tmp/0188.sql
psqlx -1 -f /tmp/0180.sql
if [ -n "${PARADOS_ANTES:-}" ]; then
  docker cp "$PARADOS_ANTES" "$NOME":/tmp/antes.sql
  psqlx -1 -f /tmp/antes.sql
fi
# PECAS = peças por OP (padrão 1000 = ~850 mil registros, 8x produção; PECAS=150 ≈ o volume de produção).
docker exec "$NOME" sed -i "s/generate_series(1, 1000) s/generate_series(1, ${PECAS:-1000}) s/" /tmp/alertas_travados_massa.sql
psqlx -f /tmp/alertas_travados_massa.sql
psqlx -f /tmp/parados_medir_massa.sql
psqlx -c "analyze"
psqlx -tA -c "select 'registros=' || count(*) || ' ordens=' || (select count(*) from sf_ordens) || ' caixas=' || (select count(*) from sf_caixas) from sf_registros"

POSTOS="array['Inicial','Teste','Embalagem','Inspeção','Almoxarifado','Manutenção','Integração']"
# A foto: a saída inteira, ordenada, das duas funções em várias combinações. md5 + contagem.
FOTO="
select 'sns ' || c.k || ' n=' || count(t.*) || ' md5=' || md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
  from (values ('ativas-24h', now() - interval '24 hours', true, true, '{}'::text[]),
               ('todas-24h', now() - interval '24 hours', false, true, '{}'::text[]),
               ('ativas-agora', now(), true, true, '{}'::text[]),
               ('todas-agora-semman', now(), false, false, '{}'::text[]),
               ('ativas-pmos', now() - interval '2 hours', true, true, array['PMO001','PMO007'])) c(k, corte, ativas, man, pmos)
  left join lateral (select * from public.alerta_travados_sns($POSTOS, c.pmos, c.corte, c.ativas, c.man)) t on true
 group by c.k
union all
select 'tela ' || c.k || ' n=' || count(t.*) || ' md5=' || md5(coalesce(string_agg(t::text, '|' order by t::text), ''))
  from (values ('ativas', now() - interval '24 hours', 'ativas', null::text[]),
               ('todas', now() - interval '24 hours', 'todas', null),
               ('finalizadas', now() - interval '24 hours', 'finalizadas', null),
               ('ativas-agora', now(), 'ativas', null),
               ('pmos', now(), 'todas', array[' PMO003 ','PMO010'])) c(k, corte, sit, pmos)
  left join lateral (select * from public.sf_pecas_paradas(c.corte, c.sit, c.pmos)) t on true
 group by c.k
order by 1;"
foto() {
  # As datas da massa caem em horas cheias: entre a foto de antes e a de depois (minutos) nenhum corte muda de lado.
  # Como superusuário (a alerta_travados_sns só tem grant para o service_role); a permissão da tela vem do teste.perms.
  psqlx -tA <<SQL
set teste.perms = 'shopfloor.visualizar';
$FOTO
SQL
}

medir() {
  echo "-- $1"
  # Como a tela: role authenticated, com permissão; a mesma chamada que o PostgREST faz (uma página de 1000).
  psqlx <<SQL | grep -E "Execution Time" | sed 's/^ */   /'
set teste.perms = 'shopfloor.visualizar';
set role authenticated;
explain (analyze, buffers, timing off) select * from public.sf_pecas_paradas(now() - interval '24 hours', 'ativas', null) limit 1000 offset 0;
explain (analyze, buffers, timing off) select * from public.sf_pecas_paradas(now() - interval '24 hours', 'ativas', null) limit 1000 offset 0;
explain (analyze, buffers, timing off) select * from public.sf_pecas_paradas(now() - interval '24 hours', 'todas', null) limit 1000 offset 0;
explain (analyze, buffers, timing off) select * from public.sf_pecas_paradas(now() - interval '24 hours', 'finalizadas', null) limit 1000 offset 0;
reset role;
set role service_role;
explain (analyze, buffers, timing off) select * from public.alerta_travados_sns($POSTOS, '{}'::text[], now() - interval '24 hours', true, true);
explain (analyze, buffers, timing off) select * from public.alerta_travados_sns($POSTOS, '{}'::text[], now() - interval '24 hours', false, true);
SQL
  echo "   (ordem: tela ativas, ativas 2a vez, todas, finalizadas; alerta ativas, alerta todas)"
  # A tela inteira como o app ANTIGO pedia: páginas de 1000 até a última (cada página roda a função de novo).
  psqlx -tA <<SQL
set teste.perms = 'shopfloor.visualizar';
set role authenticated;
do \$d\$
declare t0 timestamptz; n int; k int; pag int;
begin
  foreach k in array array[24, 0] loop
    t0 := clock_timestamp(); pag := 0;
    loop
      select count(*) into n from (select * from public.sf_pecas_paradas(now() - make_interval(hours => k), 'ativas', null)
                                    limit 1000 offset pag * 1000) x;
      pag := pag + 1;
      exit when n < 1000;
    end loop;
    raise notice '   tela paginada (ativas, % h): % páginas, % ms', k, pag, round(extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
  if to_regprocedure('public.sf_pecas_paradas_json(timestamptz, text, text[])') is not null then
    foreach k in array array[24, 0] loop
      t0 := clock_timestamp();
      execute 'select jsonb_array_length(public.sf_pecas_paradas_json(now() - make_interval(hours => \$1), ''ativas'', null))'
        into n using k;
      raise notice '   tela numa chamada (sf_pecas_paradas_json, ativas, % h): % linhas, % ms', k, n,
        round(extract(epoch from clock_timestamp() - t0) * 1000);
    end loop;
  end if;
end
\$d\$;
SQL
  psqlx -tA <<SQL
set teste.perms = 'shopfloor.visualizar';
set role authenticated;
select '   linhas tela: ativas=' || (select count(*) from public.sf_pecas_paradas(now() - interval '24 hours', 'ativas', null))
    || ' todas=' || (select count(*) from public.sf_pecas_paradas(now() - interval '24 hours', 'todas', null))
    || ' finalizadas=' || (select count(*) from public.sf_pecas_paradas(now() - interval '24 hours', 'finalizadas', null));
SQL
}

echo "######## ANTES (0188 + 0180${PARADOS_ANTES:+ + $PARADOS_ANTES})"
medir "antes"
plano() {
  [ "${PLANO:-}" = "1" ] || return 0
  psqlx <<SQL 2>&1 | grep -vE "^Query Text|^ {2,}--" | sed -n '1,400p'
set client_min_messages = log;
set auto_explain.log_min_duration = 0;
set auto_explain.log_analyze = on;
set auto_explain.log_buffers = on;
set auto_explain.log_nested_statements = on;
set auto_explain.log_level = notice;
set client_min_messages = notice;
set teste.perms = 'shopfloor.visualizar';
set role authenticated;
select count(*) from public.sf_pecas_paradas(now() - interval '24 hours', 'ativas', null);
SQL
}
plano
foto > $TMPD/foto-antes.txt
cat $TMPD/foto-antes.txt

if [ -f "$NOVA" ]; then
  docker cp "$NOVA" "$NOME":/tmp/nova.sql
  psqlx -1 -f /tmp/nova.sql
  psqlx -1 -f /tmp/nova.sql   # de novo: idempotente
  psqlx -c "analyze"
  echo "######## DEPOIS ($NOVA)"
  medir "depois"
  plano
  foto > $TMPD/foto-depois.txt
  cat $TMPD/foto-depois.txt
  if diff $TMPD/foto-antes.txt $TMPD/foto-depois.txt; then
    echo "EQUIVALENCIA OK: mesmas linhas antes e depois em todas as combinações"
  else
    echo "EQUIVALENCIA FALHOU"; exit 1
  fi
  # sf_pecas_paradas_json = as linhas da sf_pecas_paradas, na mesma ordem e com os mesmos valores (como o
  # PostgREST as serializaria: to_jsonb de cada linha).
  JSON_OK=$(psqlx -tA <<SQL
set teste.perms = 'shopfloor.visualizar';
set role authenticated;
select bool_and(a = b) from (values (now() - interval '24 hours', 'ativas'), (now(), 'todas'), (now(), 'finalizadas')) c(corte, sit)
 cross join lateral (select public.sf_pecas_paradas_json(c.corte, c.sit, null) as a) j
 cross join lateral (select coalesce(jsonb_agg(to_jsonb(y) - 'n' order by y.n), '[]'::jsonb) as b
                       from public.sf_pecas_paradas(c.corte, c.sit, null)
                            with ordinality as y(pmo, op, posto, reprovada, numero_serie, pecas, em, finalizada, n)) k;
SQL
)
  [ "$JSON_OK" = "t" ] || { echo "sf_pecas_paradas_json DIFERE da sf_pecas_paradas ($JSON_OK)"; exit 1; }
  echo "sf_pecas_paradas_json = sf_pecas_paradas (mesmas linhas, mesma ordem): ok"
fi
