-- =============================================================
-- Dashboard do ShopFloor — agregações NO BANCO, por OP e por posto.
--
-- Substitui o relatório do Looker Studio, que lê da planilha do ShopFloor LEGADO. Os números não
-- batem com os de lá de propósito: aqui é o dado do sistema, de quando o ShopFloor entrou pra cá.
--
-- Por que no banco: o dashboard cruza VÁRIAS OPs (a tela antiga era de uma só). Agregar no cliente
-- exigiria baixar `sf_registros` inteira — dezenas de milhares de linhas, e o PostgREST corta em
-- 1000 sem avisar. Cada função aqui devolve dezenas de linhas.
--
-- FILTROS (as três funções compartilham a mesma assinatura de filtro, pra tela e banco não
-- divergirem): texto vazio = "todos"; datas nulas = sem recorte.
--   p_status_op: 'aberta' | 'finalizada' | '' (todas). `sf_ordens.status` guarda 'FINALIZADA'
--   como valor terminal — a mesma regra que a tela de Ordens já usa.
--   p_posto: casa `posto` OU `posto_origem`, como no resto do sistema (a reprova que virou reparo
--   na Manutenção guarda o posto do teste em posto_origem).
-- =============================================================

-- ---------------------------------------------------------------------------
-- Indicadores do topo: Total / Aprovado / Reprovado
-- ---------------------------------------------------------------------------
-- Conta PEÇAS DISTINTAS (numero_serie_norm), não bipes — é como o relatório antigo faz: o card
-- "Total" de lá é `Nº Série` com agregação "Contar diferentes", e o título "CONTAGEM ÚNICA POR
-- NÚMERO DE SÉRIE" é literal.
--
-- Consequência que confunde quem olha de fora: **Aprovado + Reprovado não fecha com o Total**.
--   • Fica ABAIXO quando há peças que só passaram por postos sem status (Printer, Montagem PTH) —
--     ainda não foram aprovadas nem reprovadas por ninguém.
--   • Pode ESTOURAR se a mesma peça foi aprovada num posto e reprovada em outro: ela conta nos dois.
-- Os dois comportamentos são corretos e existem no relatório antigo. `bipes` vai junto pra quem
-- precisar do número de passagens.
--
-- SN é único por construção no ShopFloor, então a contagem distinta não precisa da OP na chave —
-- igual ao relatório antigo, que também conta só por número de série.
create or replace function public.sf_dashboard_totais(
  p_cliente   text default '',
  p_pmo       text default '',
  p_op        text default '',
  p_status_op text default 'aberta',
  p_de        timestamptz default null,
  p_ate       timestamptz default null,
  p_posto     text default ''
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
           'total',     count(distinct r.numero_serie_norm) filter (where r.numero_serie_norm <> ''),
           'aprovado',  count(distinct r.numero_serie_norm) filter (where lower(r.status) = 'aprovado'),
           'reprovado', count(distinct r.numero_serie_norm) filter (where lower(r.status) = 'reprovado'),
           'ops',       count(distinct r.pmo || '|' || r.op),
           'bipes',     count(*)
         )
    into v
  from sf_registros r
  join sf_ordens o on o.pmo = r.pmo and o.op = r.op
  where (p_cliente = '' or o.cliente = p_cliente)
    and (p_pmo = '' or r.pmo = p_pmo)
    and (p_op = '' or r.op = p_op)
    and (p_status_op = ''
         or (p_status_op = 'finalizada' and upper(o.status) = 'FINALIZADA')
         or (p_status_op = 'aberta' and upper(o.status) <> 'FINALIZADA'))
    and (p_de is null or r.data_hora >= p_de)
    and (p_ate is null or r.data_hora <= p_ate)
    and (p_posto = '' or r.posto = p_posto or r.posto_origem = p_posto);

  return coalesce(v, jsonb_build_object('total', 0, 'aprovado', 0, 'reprovado', 0, 'ops', 0, 'bipes', 0));
end;
$func$;

grant execute on function public.sf_dashboard_totais(text,text,text,text,timestamptz,timestamptz,text) to authenticated;

-- ---------------------------------------------------------------------------
-- A grade: uma linha por (OP, posto) — a tela pivota em OP × posto
-- ---------------------------------------------------------------------------
-- A PAGINAÇÃO é por OP, não por linha: uma OP com 12 postos tem que vir inteira, senão a linha da
-- tabela sai pela metade. Por isso o limite/offset é aplicado na lista de OPs (CTE `pagina`) e só
-- depois as contagens são buscadas.
--
-- `ops_total` viaja repetido em toda linha porque o PostgREST devolve um result set só e a tela
-- precisa dele pra montar a paginação. É redundância barata (um int por linha).
create or replace function public.sf_dashboard_grade(
  p_cliente   text default '',
  p_pmo       text default '',
  p_op        text default '',
  p_status_op text default 'aberta',
  p_de        timestamptz default null,
  p_ate       timestamptz default null,
  p_posto     text default '',
  p_limite    int default 20,
  p_offset    int default 0
)
returns table (
  pmo text, op text, cliente text, descricao text, qtd_op int, finalizada boolean,
  posto text, aprovados int, reprovados int, pecas int, ops_total int
)
language plpgsql
stable
security definer
set search_path = public
as $func$
-- `returns table` vira VARIÁVEL pra cada coluna de saída (pmo, op, cliente, posto…). Sem isto,
-- uma referência não qualificada a uma coluna de mesmo nome resolve pra variável e a consulta
-- devolve o valor errado, calada. Mesmo tropeço já visto no sf_fluxo_op.
#variable_conflict use_column
begin
  if not tem_permissao('visualizar') then
    raise exception 'SEM_PERMISSAO';
  end if;

  return query
  with ordens as (
    select o.pmo, o.op, o.cliente, o.descricao, o.qtd, upper(o.status) = 'FINALIZADA' as finalizada
    from sf_ordens o
    where (p_cliente = '' or o.cliente = p_cliente)
      and (p_pmo = '' or o.pmo = p_pmo)
      and (p_op = '' or o.op = p_op)
      and (p_status_op = ''
           or (p_status_op = 'finalizada' and upper(o.status) = 'FINALIZADA')
           or (p_status_op = 'aberta' and upper(o.status) <> 'FINALIZADA'))
  ),
  -- Só as OPs que têm bipe no recorte de data/posto: OP sem movimento no período não ocupa linha.
  com_registro as (
    select distinct r.pmo, r.op
    from sf_registros r
    where (p_de is null or r.data_hora >= p_de)
      and (p_ate is null or r.data_hora <= p_ate)
      and (p_posto = '' or r.posto = p_posto or r.posto_origem = p_posto)
  ),
  elegiveis as (
    select od.* from ordens od join com_registro cr on cr.pmo = od.pmo and cr.op = od.op
  ),
  total as (select count(*)::int as n from elegiveis),
  pagina as (
    select * from elegiveis e
    order by e.pmo, e.op
    limit greatest(1, least(p_limite, 100)) offset greatest(0, p_offset)
  )
  -- Mesma régua dos indicadores: a célula conta PEÇAS distintas, não bipes. Se um posto rebipa a
  -- mesma peça (reteste), ela continua sendo uma peça — que é o que o relatório antigo mostra.
  select p.pmo, p.op, p.cliente, p.descricao, p.qtd, p.finalizada,
         r.posto,
         count(distinct r.numero_serie_norm) filter (where lower(r.status) = 'aprovado')::int,
         count(distinct r.numero_serie_norm) filter (where lower(r.status) = 'reprovado')::int,
         count(distinct r.numero_serie_norm) filter (where r.numero_serie_norm <> '')::int,
         (select n from total)
  from pagina p
  join sf_registros r on r.pmo = p.pmo and r.op = p.op
  where (p_de is null or r.data_hora >= p_de)
    and (p_ate is null or r.data_hora <= p_ate)
    and (p_posto = '' or r.posto = p_posto or r.posto_origem = p_posto)
  group by p.pmo, p.op, p.cliente, p.descricao, p.qtd, p.finalizada, r.posto
  order by p.pmo, p.op, r.posto;
end;
$func$;

grant execute on function public.sf_dashboard_grade(text,text,text,text,timestamptz,timestamptz,text,int,int) to authenticated;

-- ---------------------------------------------------------------------------
-- Principais defeitos do recorte
-- ---------------------------------------------------------------------------
-- Irmã da `sf_defeitos_resumo` (0099/0104), que é de UMA OP. Esta cruza o mesmo filtro do dashboard.
-- Devolve o top N; a tela soma o resto num "Outros", como o relatório antigo fazia.
--
-- Conta só a REPROVA (mesma regra da 0104): a Manutenção grava o código de novo em cada conserto e
-- em cada defeito constatado, e contar essas linhas multiplicava a mesma falha.
create or replace function public.sf_dashboard_defeitos(
  p_cliente   text default '',
  p_pmo       text default '',
  p_op        text default '',
  p_status_op text default 'aberta',
  p_de        timestamptz default null,
  p_ate       timestamptz default null,
  p_posto     text default '',
  p_limite    int default 5
)
returns table (codigo text, total int, resto int)
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
  with base as (
    select r.codigo_defeito, count(*)::int as n
    from sf_registros r
    join sf_ordens o on o.pmo = r.pmo and o.op = r.op
    where r.codigo_defeito <> ''
      and lower(r.status) = 'reprovado'
      and (p_cliente = '' or o.cliente = p_cliente)
      and (p_pmo = '' or r.pmo = p_pmo)
      and (p_op = '' or r.op = p_op)
      and (p_status_op = ''
           or (p_status_op = 'finalizada' and upper(o.status) = 'FINALIZADA')
           or (p_status_op = 'aberta' and upper(o.status) <> 'FINALIZADA'))
      and (p_de is null or r.data_hora >= p_de)
      and (p_ate is null or r.data_hora <= p_ate)
      and (p_posto = '' or r.posto = p_posto or r.posto_origem = p_posto)
    group by r.codigo_defeito
  ),
  topo as (select * from base order by n desc, codigo_defeito limit greatest(1, least(p_limite, 50)))
  select t.codigo_defeito, t.n,
         -- "Outros" = tudo que ficou fora do topo, repetido em cada linha (result set único).
         coalesce((select sum(b.n)::int from base b where b.codigo_defeito not in (select codigo_defeito from topo)), 0)
  from topo t
  order by t.n desc, t.codigo_defeito;
end;
$func$;

grant execute on function public.sf_dashboard_defeitos(text,text,text,text,timestamptz,timestamptz,text,int) to authenticated;

notify pgrst, 'reload schema';
