-- Solta as peças presas: troca a dívida de rota (posto_retorno) pela versão filtrada pela rota da OP — a mesma
-- regra que a 0174 aplica daqui pra frente. Guarda o valor antigo em `correcao_reparo_rota_bkp` (para desfazer).
-- SEM -v aplicar=1 ele só MOSTRA e termina em rollback. Com -v aplicar=1 grava.
--   ensaio:  psql ... -f docs/operacao/correcao-reparo-rota/02-reparar.sql
--   aplicar: psql ... -v aplicar=1 -f docs/operacao/correcao-reparo-rota/02-reparar.sql
-- Desfazer: update sf_registros r set posto_retorno = b.posto_retorno from correcao_reparo_rota_bkp b where r.id = b.id;
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';

create table if not exists public.correcao_reparo_rota_bkp (
  id uuid primary key, posto_retorno text, feito_em timestamptz not null default now()
);

create temp table presas on commit drop as
select r.id, r.pmo, r.op, r.posto_retorno as antigo,
       case when position(',' in coalesce(public.sf_filtrar_rota_pela_op(r.pmo, r.op, r.posto_retorno), '')) = 0
            then null else public.sf_filtrar_rota_pela_op(r.pmo, r.op, r.posto_retorno) end as novo
  from sf_registros r
 where coalesce(r.posto_retorno, '') <> ''
   and not exists (select 1 from sf_registros n
                    where n.pmo = r.pmo and n.op = r.op and n.numero_serie_norm = r.numero_serie_norm
                      and (n.data_hora, n.created_at) > (r.data_hora, r.created_at))
   and public.sf_filtrar_rota_pela_op(r.pmo, r.op, split_part(r.posto_retorno, ',', 1)) is null;

insert into public.correcao_reparo_rota_bkp (id, posto_retorno)
select id, antigo from presas on conflict (id) do nothing;

update sf_registros r set posto_retorno = p.novo from presas p where r.id = p.id;

select 'linhas_corrigidas' as q, count(*)::text as dado from presas
union all select 'pecas_distintas', count(distinct (pmo, op, antigo))::text from presas;

\if :{?aplicar}
  \echo '>>> COMMIT: peças soltas'
  commit;
\else
  \echo '>>> ENSAIO: rollback, nada foi gravado'
  rollback;
\endif
