-- 0162: progresso da OP em placas. Cada SN conta `pecas` UMA vez (linha de sf_registros != bipe:
-- defeito, reparo, rebipe e reteste repetem o SN), por isso distinct on (numero_serie_norm).
-- Com placas_por_painel = 1 o resultado é idêntico ao anterior. Só a contagem muda.

-- View (0036): concluidas em placas. Mesmas colunas, mesma ordem.
create or replace view public.sf_ordem_resumo
with (security_invoker = true) as
select
  o.pmo,
  o.op,
  o.qtd,
  o.status,
  coalesce((
    select sum(x.pecas)
    from (
      select distinct on (r.numero_serie_norm) r.pecas
      from public.sf_registros r
      where r.pmo = o.pmo and r.op = o.op and r.posto = fp.posto
        and (
          lower(fp.posto) in ('inicial','montagem pth','integração','integracao','embalagem','extra máquina')
          or lower(r.status) = 'aprovado'
        )
      order by r.numero_serie_norm, r.data_hora desc
    ) x
  ), 0) as concluidas
from public.sf_ordens o
left join lateral (
  select p.posto
  from public.sf_ordem_postos p
  where p.ordem_id = o.id
  order by p.ordem desc
  limit 1
) fp on true;

grant select on public.sf_ordem_resumo to authenticated;

-- sf_ops_com_bipes (0121): `feitas` em placas; `bipes` continua count(*).
create or replace function public.sf_ops_com_bipes(p_ini timestamptz, p_fim timestamptz)
returns table (pmo text, op text, bipes bigint, pct_conclusao numeric)
language sql stable set search_path = public as $func$
  with b as (
    select r.pmo, r.op, count(*) as bipes
    from public.sf_registros r
    where (p_ini is null or r.data_hora >= p_ini)
      and (p_fim is null or r.data_hora < p_fim)
    group by r.pmo, r.op
  ),
  ult as (
    select o.pmo, o.op, o.qtd,
           (select p.posto from public.sf_ordem_postos p where p.ordem_id = o.id order by p.ordem desc limit 1) as posto
    from public.sf_ordens o
    join b on b.pmo = o.pmo and b.op = o.op
  ),
  c as (
    select s.pmo, s.op, sum(s.pecas) as feitas
    from (
      select distinct on (u.pmo, u.op, r.numero_serie_norm) u.pmo, u.op, r.pecas
      from ult u
      join public.sf_registros r on r.pmo = u.pmo and r.op = u.op and r.posto = u.posto
      where lower(r.status) <> 'reprovado'
      order by u.pmo, u.op, r.numero_serie_norm, r.data_hora desc
    ) s
    group by s.pmo, s.op
  )
  select b.pmo, b.op, b.bipes,
         case when coalesce(u.qtd, 0) > 0 then (floor(1000.0 * coalesce(c.feitas, 0) / u.qtd) / 10)::numeric(6,1) end as pct_conclusao
  from b
  left join ult u on u.pmo = b.pmo and u.op = b.op
  left join c on c.pmo = b.pmo and c.op = b.op
$func$;

revoke all on function public.sf_ops_com_bipes(timestamptz, timestamptz) from public, anon;
grant execute on function public.sf_ops_com_bipes(timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
