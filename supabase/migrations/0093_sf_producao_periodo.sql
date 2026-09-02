-- Fluxo — gráfico de produção por período no detalhe do posto (peças produzidas × dia/hora).
-- Agrega no banco (não puxa milhares de linhas pro cliente). Bucket por DIA (macro) ou HORA (filtro
-- de um dia), no fuso de produção (America/Sao_Paulo). p_ini/p_fim null = da 1ª à última passagem
-- do posto (desde o início da produção ali). Conta REGISTROS no posto (throughput).
create or replace function public.sf_producao_periodo(
  p_pmo    text,
  p_op     text,
  p_posto  text,
  p_ini    timestamptz,
  p_fim    timestamptz,
  p_bucket text
) returns table (rotulo text, qtd int)
  language plpgsql
  stable
  security definer
  set search_path = public
as $func$
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with trunc as (
    select date_trunc(
             case when lower(p_bucket) = 'hora' then 'hour' else 'day' end,
             (data_hora at time zone 'America/Sao_Paulo')
           ) as bkt
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_serie_norm <> ''
      and (p_ini is null or data_hora >= p_ini)
      and (p_fim is null or data_hora <= p_fim)
  )
  select to_char(bkt, case when lower(p_bucket) = 'hora' then 'DD/MM HH24"h"' else 'DD/MM' end) as rotulo,
         count(*)::int as qtd
  from trunc
  group by bkt
  order by bkt;
end;
$func$;

notify pgrst, 'reload schema';
