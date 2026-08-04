-- =============================================================
-- Fluxo da OP (estilo n8n): agregados por posto para o canvas.
-- WIP = posição atual da peça (último bipe; reprovado → Manutenção).
-- aprovadas/reprovadas/registros/retestes = TODOS os registros do posto.
-- retestes = SNs distintos com ≥2 registros no posto (reteste).
-- =============================================================
create or replace function public.sf_fluxo_op(p_pmo text, p_op text)
returns table (
  posto      text,
  wip        int,
  registros  int,
  aprovadas  int,
  reprovadas int,
  retestes   int
)
language plpgsql
stable
security definer
set search_path = public
as $$
-- OUT columns do RETURNS TABLE (posto/wip/...) viram variáveis no plpgsql e colidiriam
-- com as colunas homônimas das CTEs; use_column resolve toda referência bare como coluna.
#variable_conflict use_column
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with regs as (
    select numero_serie_norm, posto, status, data_hora, created_at
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
  ),
  ult as ( -- último registro por SN (desempata por created_at)
    select distinct on (numero_serie_norm) numero_serie_norm, posto, status
    from regs
    order by numero_serie_norm, data_hora desc, created_at desc
  ),
  wip_t as ( -- reprovado → Manutenção; senão → posto do último registro
    select case when lower(status) = 'reprovado' then 'Manutenção' else posto end as posto,
           count(*)::int as wip
    from ult
    group by 1
  ),
  por_sn_posto as ( -- nº de registros de cada SN em cada posto (p/ retestes)
    select posto, numero_serie_norm, count(*) as vezes
    from regs
    group by posto, numero_serie_norm
  ),
  agg as (
    select posto,
           count(*) filter (where lower(status) = 'aprovado')::int  as aprovadas,
           count(*) filter (where lower(status) = 'reprovado')::int as reprovadas,
           count(*)::int as registros
    from regs
    group by posto
  ),
  ret as (
    select posto, count(*) filter (where vezes >= 2)::int as retestes
    from por_sn_posto
    group by posto
  ),
  postos as (
    select posto from agg
    union
    select posto from wip_t
  )
  select p.posto,
         coalesce(w.wip, 0)        as wip,
         coalesce(a.registros, 0)  as registros,
         coalesce(a.aprovadas, 0)  as aprovadas,
         coalesce(a.reprovadas, 0) as reprovadas,
         coalesce(rt.retestes, 0)  as retestes
  from postos p
  left join wip_t w on w.posto = p.posto
  left join agg   a on a.posto = p.posto
  left join ret  rt on rt.posto = p.posto;
end;
$$;
