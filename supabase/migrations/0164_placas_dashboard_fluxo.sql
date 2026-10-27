-- 0164: Dashboard e Fluxo em placas por painel. Só a CONTAGEM muda; assinatura, colunas, ordem,
-- grants, segurança e tem_permissao (1 argumento, como na definição vigente) ficam como estavam.
-- Com placas_por_painel = 1 (toda OP existente) o resultado é idêntico ao anterior.
--
-- Duas regras, conforme o que o número contava antes:
--
-- (1) Contagens POR PEÇA (count distinct SN, ou uma linha por SN): cada SN soma `pecas` UMA vez,
--     valendo a linha mais recente — distinct on (numero_serie_norm) sobre o mesmo from/where de antes.
--     sf_dashboard_totais (total/aprovado/reprovado), sf_dashboard_grade, sf_fluxo_op (wip,
--     aprovados_primeira, reprovados_sem_reteste, passou_distinto).
--
-- (2) Contagens POR LINHA (count(*)): sf_fluxo_op (registros/aprovadas/reprovadas),
--     sf_fluxo_periodo e sf_producao_periodo. Um bipe grava as suas linhas na mesma transação, logo
--     com o mesmo data_hora: reprovado com 3 defeitos = 3 linhas, reparo = 1 linha por conserto.
--     Hoje cada uma dessas linhas conta 1. Regra: o BIPE (posto, SN, status, data_hora) vale `pecas`
--     e cada linha EXTRA do mesmo bipe continua valendo 1, como hoje — peso = max(pecas) + count(*) - 1.
--     N=1: peso = count(*) (idêntico). N=50: painel aprovado = 50; painel reprovado com 3 defeitos
--     = 50 + 2. Deduplicar o bipe inteiro (peso = pecas) mudaria o número de hoje das OPs com N=1
--     (3 linhas de defeito passariam a contar 1), por isso as linhas extras ficam como estão.
--
-- Não mudam: sf_dashboard_totais.bipes/ops, sf_dashboard_graficos, sf_ops_com_bipes.bipes,
-- sf_fluxo_op.retestes/primeiro_em/ultimo_em, sf_defeitos_resumo, alerta_*.

-- ---------------------------------------------------------------------------
-- sf_dashboard_totais (0105): total/aprovado/reprovado em placas.
-- ---------------------------------------------------------------------------
create or replace function public.sf_dashboard_totais(
  p_cliente text default '', p_pmo text default '', p_op text default '', p_status_op text default 'aberta',
  p_de timestamptz default null, p_ate timestamptz default null, p_posto text default '',
  p_colaborador text default '', p_sn text default '',
  p_status text default '', p_tipo text default '', p_defeito text default '', p_posicao text default ''
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $func$
declare
  v jsonb;
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  with b as materialized (
    select * from sf_dashboard_base(p_cliente, p_pmo, p_op, p_status_op, p_de, p_ate, p_posto, p_colaborador, p_sn,
                              p_status, p_tipo, p_defeito, p_posicao)
  )
  select jsonb_build_object(
           'total', (select coalesce(sum(u.pecas), 0) from (
                       select distinct on (b.numero_serie_norm) b.pecas from b
                       where b.numero_serie_norm <> ''
                       order by b.numero_serie_norm, b.data_hora desc, b.created_at desc) u),
           'aprovado', (select coalesce(sum(u.pecas), 0) from (
                       select distinct on (b.numero_serie_norm) b.pecas from b
                       where b.numero_serie_norm <> '' and lower(b.status) = 'aprovado'
                       order by b.numero_serie_norm, b.data_hora desc, b.created_at desc) u),
           'reprovado', (select coalesce(sum(u.pecas), 0) from (
                       select distinct on (b.numero_serie_norm) b.pecas from b
                       where b.numero_serie_norm <> '' and lower(b.status) = 'reprovado'
                       order by b.numero_serie_norm, b.data_hora desc, b.created_at desc) u),
           'ops',       (select count(distinct b.pmo || '|' || b.op) from b),
           'bipes',     (select count(*) from b)
         )
    into v;

  return v;
end;
$func$;

grant execute on function public.sf_dashboard_totais(text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- sf_dashboard_grade (0105): pecas_op, aprovados, reprovados, sem_status em placas.
-- ---------------------------------------------------------------------------
create or replace function public.sf_dashboard_grade(
  p_cliente text default '', p_pmo text default '', p_op text default '', p_status_op text default 'aberta',
  p_de timestamptz default null, p_ate timestamptz default null, p_posto text default '',
  p_colaborador text default '', p_sn text default '',
  p_status text default '', p_tipo text default '', p_defeito text default '', p_posicao text default '',
  p_limite int default 20, p_offset int default 0
)
returns table (
  pmo text, op text, cliente text, descricao text, qtd_op int, finalizada boolean,
  posto text, aprovados int, reprovados int, sem_status int, pecas_op int, ops_total int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
-- `returns table` vira VARIÁVEL pra cada coluna de saída; sem isto uma coluna de mesmo nome
-- resolve pra variável e a consulta devolve valor errado, calada (mesmo tropeço do sf_fluxo_op).
#variable_conflict use_column
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with base as materialized (
    select * from sf_dashboard_base(p_cliente, p_pmo, p_op, p_status_op, p_de, p_ate, p_posto, p_colaborador, p_sn,
                            p_status, p_tipo, p_defeito, p_posicao)
  ),
  -- O SN vazio não é peça (antes: count distinct ... filter sn <> ''), mas a OP continua na lista.
  por_op as (
    select pmo, op, sum(case when numero_serie_norm <> '' then pecas else 0 end)::int as pecas
    from (
      select distinct on (b.pmo, b.op, b.numero_serie_norm) b.pmo, b.op, b.numero_serie_norm, b.pecas
      from base b
      order by b.pmo, b.op, b.numero_serie_norm, b.data_hora desc, b.created_at desc
    ) u
    group by pmo, op
  ),
  total as (select count(*)::int as n from por_op),
  pagina as (
    select p.pmo, p.op, p.pecas, o.cliente, o.descricao, o.qtd, upper(o.status) = 'FINALIZADA' as finalizada
    from por_op p
    join sf_ordens o on o.pmo = p.pmo and o.op = p.op
    order by p.pecas desc, p.pmo, p.op
    limit greatest(1, least(p_limite, 100)) offset greatest(0, p_offset)
  ),
  -- Peças por (OP, posto, status): cada SN uma vez por célula, valendo a linha mais recente.
  celula as (
    select x.pmo, x.op, x.posto,
           coalesce(sum(x.pecas) filter (where x.cat = 'a'), 0)::int as aprovados,
           coalesce(sum(x.pecas) filter (where x.cat = 'r'), 0)::int as reprovados,
           coalesce(sum(x.pecas) filter (where x.cat = 's'), 0)::int as sem_status
    from (
      select distinct on (b.pmo, b.op, b.posto, c.cat, b.numero_serie_norm) b.pmo, b.op, b.posto, c.cat, b.pecas
      from base b
      join pagina pg on pg.pmo = b.pmo and pg.op = b.op
      cross join lateral (
        select case when lower(b.status) = 'aprovado' then 'a'
                    when lower(b.status) = 'reprovado' then 'r'
                    when b.status = '' then 's' end as cat
      ) c
      where b.numero_serie_norm <> '' and c.cat is not null
      order by b.pmo, b.op, b.posto, c.cat, b.numero_serie_norm, b.data_hora desc, b.created_at desc
    ) x
    group by x.pmo, x.op, x.posto
  ),
  postos_op as (
    select distinct b.pmo, b.op, b.posto
    from base b
    join pagina pg on pg.pmo = b.pmo and pg.op = b.op
  )
  select pg.pmo, pg.op, pg.cliente, pg.descricao, pg.qtd, pg.finalizada,
         po.posto,
         coalesce(c.aprovados, 0),
         coalesce(c.reprovados, 0),
         coalesce(c.sem_status, 0),
         pg.pecas,
         (select n from total)
  from pagina pg
  join postos_op po on po.pmo = pg.pmo and po.op = pg.op
  left join celula c on c.pmo = po.pmo and c.op = po.op and c.posto = po.posto
  order by pg.pecas desc, pg.pmo, pg.op, po.posto;
end;
$func$;

grant execute on function public.sf_dashboard_grade(text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text,int,int) to authenticated;

-- ---------------------------------------------------------------------------
-- sf_fluxo_op (0157): wip/passou_distinto/aprovados_primeira/reprovados_sem_reteste por peça (1);
-- registros/aprovadas/reprovadas por linha (2). retestes, primeiro_em e ultimo_em não mudam.
-- ---------------------------------------------------------------------------
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
    select numero_serie_norm, posto, status, posto_retorno, data_hora, created_at, pecas
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
  ),
  ult as ( -- último registro por SN (desempata por created_at)
    select distinct on (numero_serie_norm) numero_serie_norm, posto, status, posto_retorno, pecas
    from regs
    order by numero_serie_norm, data_hora desc, created_at desc
  ),
  wip_t as (
    select case
             when coalesce(posto_retorno, '') <> '' then split_part(posto_retorno, ',', 1)
             when lower(status) = 'reprovado' then 'Manutenção'
             else posto
           end as posto,
           sum(pecas)::int as wip
    from ult
    group by 1
  ),
  por_sn_posto as (
    select posto, numero_serie_norm, count(*) as vezes
    from regs
    group by posto, numero_serie_norm
  ),
  bipes as ( -- (2): o bipe vale `pecas`; cada linha extra do mesmo bipe vale 1, como hoje
    select posto, status, data_hora, max(pecas) + count(*) - 1 as peso
    from regs
    group by posto, numero_serie_norm, status, data_hora
  ),
  agg as (
    select posto,
           coalesce(sum(peso) filter (where lower(status) = 'aprovado'), 0)::int  as aprovadas,
           coalesce(sum(peso) filter (where lower(status) = 'reprovado'), 0)::int as reprovadas,
           sum(peso)::int as registros,
           min(data_hora) as primeiro_em,
           max(data_hora) as ultimo_em
    from bipes
    group by posto
  ),
  ret as (
    select posto, count(*) filter (where vezes >= 2)::int as retestes
    from por_sn_posto
    group by posto
  ),
  primeiro as ( -- status da 1ª passagem por (posto, SN); a ENTRADA do Burn-in (status vazio) não é passagem
    select distinct on (r.posto, r.numero_serie_norm) r.posto, r.numero_serie_norm, r.status, r.pecas
    from regs r
    where not (
      coalesce(r.status, '') = ''
      and exists (
        select 1 from sf_postos po
          join sf_posto_perfis pe on pe.chave = po.perfil
         where po.chave = r.posto and pe.recurso = 'burnin'
      )
    )
    order by r.posto, r.numero_serie_norm, r.data_hora asc, r.created_at asc
  ),
  ultimo as ( -- status da ÚLTIMA passagem por (posto, SN)
    select distinct on (posto, numero_serie_norm) posto, numero_serie_norm, status, pecas
    from regs
    order by posto, numero_serie_norm, data_hora desc, created_at desc
  ),
  fp as (
    select posto, coalesce(sum(pecas) filter (where lower(status) = 'aprovado'), 0)::int as aprovados_primeira
    from primeiro group by posto
  ),
  rp as (
    select posto, coalesce(sum(pecas) filter (where lower(status) = 'reprovado'), 0)::int as reprovados_sem_reteste
    from ultimo group by posto
  ),
  pd as ( -- PEÇAS DISTINTAS que passaram: último status por (posto,SN) que NÃO é reprovado
    select posto, coalesce(sum(pecas) filter (where lower(status) <> 'reprovado'), 0)::int as passou_distinto
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

-- ---------------------------------------------------------------------------
-- sf_fluxo_periodo (0090): registros/aprovadas/reprovadas por posto, regra (2).
-- ---------------------------------------------------------------------------
create or replace function public.sf_fluxo_periodo(
  p_pmo text, p_op text, p_ini timestamptz, p_fim timestamptz
)
returns table (posto text, registros int, aprovadas int, reprovadas int)
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
  select g.posto,
         sum(g.peso)::int                                                          as registros,
         coalesce(sum(g.peso) filter (where lower(g.status) = 'aprovado'), 0)::int  as aprovadas,
         coalesce(sum(g.peso) filter (where lower(g.status) = 'reprovado'), 0)::int as reprovadas
  from (
    select posto, status, max(pecas) + count(*) - 1 as peso
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm <> ''
      and data_hora >= p_ini and data_hora < p_fim
    group by posto, numero_serie_norm, status, data_hora
  ) g
  group by g.posto;
end;
$func$;

grant execute on function public.sf_fluxo_periodo(text, text, timestamptz, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- sf_producao_periodo (0093): qtd por bucket, regra (2).
-- ---------------------------------------------------------------------------
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
           ) as bkt,
           max(pecas) + count(*) - 1 as peso
    from sf_registros
    where pmo = p_pmo and op = p_op and posto = p_posto and numero_serie_norm <> ''
      and (p_ini is null or data_hora >= p_ini)
      and (p_fim is null or data_hora <= p_fim)
    group by numero_serie_norm, status, data_hora
  )
  select to_char(bkt, case when lower(p_bucket) = 'hora' then 'DD/MM HH24"h"' else 'DD/MM' end) as rotulo,
         sum(peso)::int as qtd
  from trunc
  group by bkt
  order by bkt;
end;
$func$;

notify pgrst, 'reload schema';
