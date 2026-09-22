-- =============================================================
-- Fluxo: % de conclusão de cada OP na lista de OPs (card da sprint 14/09/2026).
-- % = peças diferentes que passaram pelo ÚLTIMO posto do fluxo da OP sem estar reprovadas
--     ÷ quantidade da OP. Truncada em 1 casa (99,96 mostra 99,9 — nunca arredonda pra 100).
-- Conta a OP inteira (não só o período do filtro). Medido no RDS em 22/09/2026: 72 ms com
-- 30 dias (12 OPs).
--
-- Muda o retorno → a assinatura da 0120 sai antes.
-- =============================================================

drop function if exists public.sf_ops_com_bipes(timestamptz, timestamptz);

create function public.sf_ops_com_bipes(p_ini timestamptz, p_fim timestamptz)
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
    select u.pmo, u.op, count(distinct r.numero_serie_norm) as feitas
    from ult u
    join public.sf_registros r on r.pmo = u.pmo and r.op = u.op and r.posto = u.posto
    where lower(r.status) <> 'reprovado'
    group by u.pmo, u.op
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
