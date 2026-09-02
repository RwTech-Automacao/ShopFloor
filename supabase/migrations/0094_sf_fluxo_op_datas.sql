-- Fluxo — cadência MACRO: a RPC passa a devolver o 1º e o último registro de cada posto
-- (primeiro_em/ultimo_em), pra o cliente calcular os minutos úteis (matutino+vespertino de cada dia)
-- da produção do posto sem filtro. Recria a função (muda o returns table → DROP antes). Corpo = 0092
-- + as duas colunas de data no agg. Idempotente.
drop function if exists public.sf_fluxo_op(text, text);

create or replace function public.sf_fluxo_op(p_pmo text, p_op text)
returns table (
  posto                  text,
  wip                    int,
  registros              int,
  aprovadas              int,
  reprovadas             int,
  retestes               int,
  aprovados_primeira     int,
  reprovados_sem_reteste int,
  passou_distinto        int,
  primeiro_em            timestamptz,
  ultimo_em              timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with regs as (
    select numero_serie_norm, posto, status, posto_retorno, data_hora, created_at
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
  ),
  ult as ( -- último registro por SN (desempata por created_at)
    select distinct on (numero_serie_norm) numero_serie_norm, posto, status, posto_retorno
    from regs
    order by numero_serie_norm, data_hora desc, created_at desc
  ),
  wip_t as (
    select case
             when coalesce(posto_retorno, '') <> '' then split_part(posto_retorno, ',', 1)
             when lower(status) = 'reprovado' then 'Manutenção'
             else posto
           end as posto,
           count(*)::int as wip
    from ult
    group by 1
  ),
  por_sn_posto as (
    select posto, numero_serie_norm, count(*) as vezes
    from regs
    group by posto, numero_serie_norm
  ),
  agg as (
    select posto,
           count(*) filter (where lower(status) = 'aprovado')::int  as aprovadas,
           count(*) filter (where lower(status) = 'reprovado')::int as reprovadas,
           count(*)::int as registros,
           min(data_hora) as primeiro_em,
           max(data_hora) as ultimo_em
    from regs
    group by posto
  ),
  ret as (
    select posto, count(*) filter (where vezes >= 2)::int as retestes
    from por_sn_posto
    group by posto
  ),
  primeiro as ( -- status da 1ª passagem por (posto, SN)
    select distinct on (posto, numero_serie_norm) posto, numero_serie_norm, status
    from regs
    order by posto, numero_serie_norm, data_hora asc, created_at asc
  ),
  ultimo as ( -- status da ÚLTIMA passagem por (posto, SN)
    select distinct on (posto, numero_serie_norm) posto, numero_serie_norm, status
    from regs
    order by posto, numero_serie_norm, data_hora desc, created_at desc
  ),
  fp as (
    select posto, count(*) filter (where lower(status) = 'aprovado')::int as aprovados_primeira
    from primeiro group by posto
  ),
  rp as (
    select posto, count(*) filter (where lower(status) = 'reprovado')::int as reprovados_sem_reteste
    from ultimo group by posto
  ),
  pd as ( -- PEÇAS DISTINTAS que passaram: último status por (posto,SN) que NÃO é reprovado
    select posto, count(*) filter (where lower(status) <> 'reprovado')::int as passou_distinto
    from ultimo group by posto
  ),
  postos as (
    select posto from agg
    union
    select posto from wip_t
  )
  select p.posto,
         coalesce(w.wip, 0)         as wip,
         coalesce(a.registros, 0)   as registros,
         coalesce(a.aprovadas, 0)   as aprovadas,
         coalesce(a.reprovadas, 0)  as reprovadas,
         coalesce(rt.retestes, 0)   as retestes,
         coalesce(fp.aprovados_primeira, 0)     as aprovados_primeira,
         coalesce(rp.reprovados_sem_reteste, 0) as reprovados_sem_reteste,
         coalesce(pd.passou_distinto, 0)        as passou_distinto,
         a.primeiro_em,
         a.ultimo_em
  from postos p
  left join wip_t w on w.posto = p.posto
  left join agg   a on a.posto = p.posto
  left join ret  rt on rt.posto = p.posto
  left join fp      on fp.posto = p.posto
  left join rp      on rp.posto = p.posto
  left join pd      on pd.posto = p.posto;
end;
$func$;

notify pgrst, 'reload schema';
