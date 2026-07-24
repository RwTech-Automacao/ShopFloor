-- =============================================================
-- ShopFloor Processo — resumo por OP p/ o dropdown da Integração.
-- concluidas = SNs distintos que passaram/aprovaram no POSTO FINAL do
-- fluxo da OP (aprovado se o posto final tem status; registrado se sem-status).
-- security_invoker = true → respeita a RLS de quem consulta.
-- =============================================================

create or replace view public.sf_ordem_resumo
with (security_invoker = true) as
select
  o.pmo,
  o.op,
  o.qtd,
  o.status,
  coalesce((
    select count(distinct r.numero_serie_norm)
    from public.sf_registros r
    where r.pmo = o.pmo and r.op = o.op and r.posto = fp.posto
      and (
        lower(fp.posto) in ('inicial','montagem pth','integração','integracao','embalagem','extra máquina')
        or lower(r.status) = 'aprovado'
      )
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
