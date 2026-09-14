-- =============================================================
-- Dashboard: filtrar clicando nos gráficos (como no relatório legado do Looker).
--
-- Clicar numa OP, num posto, em Aprovado/Reprovado, num tipo, num defeito ou numa posição filtra a
-- tela inteira — cartões, tabela e gráficos. OP e posto já eram filtros; esta migração acrescenta os
-- quatro que só existem pelo clique: p_status, p_tipo, p_defeito, p_posicao.
--
-- O filtro mora na `sf_dashboard_base`, o lugar único do recorte: as três funções que a usam
-- recebem os parâmetros novos e só os repassam. Corpo idêntico ao da 0101 fora isso.
--
-- As assinaturas mudam, então as versões da 0101 são removidas antes — sem isso o Postgres criaria
-- sobrecargas, e o PostgREST não saberia qual chamar. `sf_dashboard_topo` e
-- `sf_dashboard_colaboradores` não mudam e ficam como estão. Idempotente.
-- =============================================================

drop function if exists public.sf_dashboard_totais(text,text,text,text,timestamptz,timestamptz,text,text,text);
drop function if exists public.sf_dashboard_grade(text,text,text,text,timestamptz,timestamptz,text,text,text,int,int);
drop function if exists public.sf_dashboard_graficos(text,text,text,text,timestamptz,timestamptz,text,text,text);
drop function if exists public.sf_dashboard_base(text,text,text,text,timestamptz,timestamptz,text,text,text);

-- ---------------------------------------------------------------------------
-- Base: os registros do recorte. Um lugar só pro filtro, pras funções não divergirem.
-- ---------------------------------------------------------------------------
-- LANGUAGE SQL, STABLE, sem SECURITY DEFINER e sem SET: são as condições pro planner INLINAR a
-- função na consulta de quem chama — o filtro vira parte do plano, com índices, em vez de uma
-- caixa-preta materializada. Chamada pelas funções abaixo (security definer), roda como dona.
-- Chamada direto pelo cliente, cairia na RLS de sf_registros — e o execute é revogado mesmo assim.
create or replace function public.sf_dashboard_base(
  p_cliente text, p_pmo text, p_op text, p_status_op text,
  p_de timestamptz, p_ate timestamptz, p_posto text, p_colaborador text, p_sn text,
  p_status text, p_tipo text, p_defeito text, p_posicao text
)
returns setof public.sf_registros
language sql
stable
as $func$
  select r.*
  from public.sf_registros r
  join public.sf_ordens o on o.pmo = r.pmo and o.op = r.op
  where (p_cliente = '' or o.cliente = p_cliente)
    and (p_pmo = '' or r.pmo = p_pmo)
    and (p_op = '' or r.op = p_op)
    and (p_status_op = ''
         or (p_status_op = 'finalizada' and upper(o.status) = 'FINALIZADA')
         or (p_status_op = 'aberta' and upper(o.status) <> 'FINALIZADA'))
    and (p_de is null or r.data_hora >= p_de)
    and (p_ate is null or r.data_hora <= p_ate)
    and (p_posto = '' or r.posto = p_posto)
    and (p_colaborador = '' or lower(btrim(r.colaborador)) = lower(btrim(p_colaborador)))
    and (p_sn = '' or r.numero_serie_norm = p_sn)
    -- Filtros do CLIQUE nos gráficos (0105). Status é o do bipe. Tipo, defeito e posição olham só a
    -- REPROVA (regra da 0104): a Manutenção repete os três em cada conserto, e sem isto o filtro
    -- traria as linhas de reparo junto.
    and (p_status = '' or lower(r.status) = lower(p_status))
    and (p_tipo = '' or (r.tipo_defeito = p_tipo and lower(r.status) = 'reprovado'))
    and (p_defeito = '' or (r.codigo_defeito = p_defeito and lower(r.status) = 'reprovado'))
    and (p_posicao = '' or (r.posicao = p_posicao and lower(r.status) = 'reprovado'))
$func$;

revoke all on function public.sf_dashboard_base(text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Indicadores: Total / Aprovado / Reprovado — régua PEÇAS (igual ao legado)
-- ---------------------------------------------------------------------------
-- Aprovado + Reprovado não fecha com o Total, e isso é correto (e acontece no legado):
--   • fica ABAIXO quando há peças que só passaram por postos sem status (Printer, Montagem PTH);
--   • pode ESTOURAR quando a mesma peça foi aprovada num posto e reprovada em outro.
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

  select jsonb_build_object(
           'total',     count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> ''),
           'aprovado',  count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> '' and lower(b.status) = 'aprovado'),
           'reprovado', count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> '' and lower(b.status) = 'reprovado'),
           'ops',       count(distinct b.pmo || '|' || b.op),
           'bipes',     count(*)
         )
    into v
  from sf_dashboard_base(p_cliente, p_pmo, p_op, p_status_op, p_de, p_ate, p_posto, p_colaborador, p_sn,
                            p_status, p_tipo, p_defeito, p_posicao) b;

  return v;
end;
$func$;

grant execute on function public.sf_dashboard_totais(text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- Tabela: uma linha por (OP, posto) — a tela pivota em OP × posto → status. Régua PEÇAS.
-- ---------------------------------------------------------------------------
-- O legado agrupa por PMO; aqui a linha é a OP (decisão de 11/09: o padrão é "OPs ativas" e o
-- status é da OP — por PMO a linha misturaria OPs). A CONTA da célula é a do legado: peças
-- distintas por posto e por status, INCLUSIVE status vazio, porque a tabela do legado não tem
-- filtro nenhum. É o que faz Printer e Montagem PTH mostrarem quantas peças passaram por lá.
--
-- Paginação por OP (uma OP com 12 postos vem inteira), ordenada como no legado: mais peças primeiro.
-- `ops_total` viaja repetido em toda linha porque o PostgREST devolve um result set só.
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
  por_op as (
    select b.pmo, b.op, count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> '')::int as pecas
    from base b
    group by b.pmo, b.op
  ),
  total as (select count(*)::int as n from por_op),
  pagina as (
    select p.pmo, p.op, p.pecas, o.cliente, o.descricao, o.qtd, upper(o.status) = 'FINALIZADA' as finalizada
    from por_op p
    join sf_ordens o on o.pmo = p.pmo and o.op = p.op
    order by p.pecas desc, p.pmo, p.op
    limit greatest(1, least(p_limite, 100)) offset greatest(0, p_offset)
  )
  select pg.pmo, pg.op, pg.cliente, pg.descricao, pg.qtd, pg.finalizada,
         b.posto,
         count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> '' and lower(b.status) = 'aprovado')::int,
         count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> '' and lower(b.status) = 'reprovado')::int,
         count(distinct b.numero_serie_norm) filter (where b.numero_serie_norm <> '' and b.status = '')::int,
         pg.pecas,
         (select n from total)
  from pagina pg
  join base b on b.pmo = pg.pmo and b.op = pg.op
  group by pg.pmo, pg.op, pg.cliente, pg.descricao, pg.qtd, pg.finalizada, pg.pecas, b.posto
  order by pg.pecas desc, pg.pmo, pg.op, b.posto;
end;
$func$;

grant execute on function public.sf_dashboard_grade(text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text,int,int) to authenticated;

-- ---------------------------------------------------------------------------
-- Gráficos: status, tipo, por OP, defeitos, posições — régua REGISTROS (igual ao legado)
-- ---------------------------------------------------------------------------
-- Um jsonb só, com a mesma foto do mesmo filtro. Cada bloco segue o gráfico do legado:
--   status   → Record Count por Status, sem status vazio ("Nulo Status"); 10 + Outros.
--   tipo     → Record Count por Tipo de Componente, sem tipo vazio ("Nulo Tipo Comp"); 10 + Outros.
--   ops      → Record Count por OP × Status, sem status vazio; as 10 OPs com mais registros.
--              (No legado é por PMO; aqui por OP, junto com a tabela.)
--   defeitos → Record Count por Código Defeito, com status e com código; 6 + Outros.
--   posicoes → Record Count por Posição, com tipo; 15 + Outros.
-- Tipo, defeitos e posições contam só a REPROVA (0104): a Manutenção repete código, tipo e posição
-- em cada conserto e em cada defeito constatado, e contar essas linhas multiplicava a mesma falha.
create or replace function public.sf_dashboard_graficos(
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

  with base as materialized (
    select * from sf_dashboard_base(p_cliente, p_pmo, p_op, p_status_op, p_de, p_ate, p_posto, p_colaborador, p_sn,
                            p_status, p_tipo, p_defeito, p_posicao)
  ),
  st as (
    select b.status as rotulo, count(*)::int as n from base b where b.status <> '' group by b.status
  ),
  tp as (
    select b.tipo_defeito as rotulo, count(*)::int as n
    from base b where b.tipo_defeito <> '' and lower(b.status) = 'reprovado' group by b.tipo_defeito
  ),
  df as (
    select b.codigo_defeito as rotulo, count(*)::int as n
    from base b where b.codigo_defeito <> '' and lower(b.status) = 'reprovado' group by b.codigo_defeito
  ),
  ps as (
    select b.posicao as rotulo, count(*)::int as n
    from base b where b.posicao <> '' and b.tipo_defeito <> '' and lower(b.status) = 'reprovado' group by b.posicao
  ),
  op_tot as (
    select b.pmo, b.op, count(*)::int as n, row_number() over (order by count(*) desc, b.pmo, b.op) as rk
    from base b where b.status <> '' group by b.pmo, b.op
  ),
  op_st as (
    select t.rk, t.pmo, t.op, t.n, b.status, count(*)::int as ns
    from op_tot t join base b on b.pmo = t.pmo and b.op = t.op and b.status <> ''
    where t.rk <= 10
    group by t.rk, t.pmo, t.op, t.n, b.status
  )
  select jsonb_build_object(
    'status',   sf_dashboard_topo((select coalesce(jsonb_agg(jsonb_build_object('rotulo', rotulo, 'valor', n)), '[]') from st), 10),
    'tipo',     sf_dashboard_topo((select coalesce(jsonb_agg(jsonb_build_object('rotulo', rotulo, 'valor', n)), '[]') from tp), 10),
    'defeitos', sf_dashboard_topo((select coalesce(jsonb_agg(jsonb_build_object('rotulo', rotulo, 'valor', n)), '[]') from df), 6),
    'posicoes', sf_dashboard_topo((select coalesce(jsonb_agg(jsonb_build_object('rotulo', rotulo, 'valor', n)), '[]') from ps), 15),
    'ops', coalesce((
      select jsonb_agg(o order by (o->>'rk')::int)
      from (
        select jsonb_build_object('rk', rk, 'pmo', pmo, 'op', op, 'total', n,
                                  'porStatus', jsonb_object_agg(status, ns)) as o
        from op_st group by rk, pmo, op, n
      ) x
    ), '[]')
  ) into v;

  return v;
end;
$func$;

grant execute on function public.sf_dashboard_graficos(text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,text) to authenticated;

notify pgrst, 'reload schema';
