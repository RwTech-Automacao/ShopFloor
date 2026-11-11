-- Exporta as OPs que já rodaram no ShopFloor para /tmp/ops-shopfloor.csv — SÓ LEITURA (begin ... rollback).
-- Entrada do tools/compels/mapa-ops.mjs, que cruza cada OP com a árvore de OPs do Compels.
\set ON_ERROR_STOP on
begin;
create temp view v_ops as
with rota as (
  select p.ordem_id, string_agg(p.posto, ' > ' order by p.ordem) as rota,
         (array_agg(p.posto order by p.ordem desc))[1] as ultimo_posto
    from sf_ordem_postos p group by p.ordem_id
), regs as (
  select r.pmo, r.op, count(*) as registros, min(r.data_hora) as primeiro, max(r.data_hora) as ultimo
    from sf_registros r group by r.pmo, r.op
), almox as (
  select e.pmo, e.op, sum(e.quantidade) filter (where e.ok and e.operacao = 'entrada') as entradas,
         sum(e.quantidade) filter (where e.ok and e.operacao = 'estorno') as estornos
    from sf_estoque_envios e group by e.pmo, e.op
)
select o.pmo, o.op, o.cliente, o.qtd, o.status, coalesce(rt.rota, '') as rota, coalesce(rt.ultimo_posto, '') as ultimo_posto,
       (select count(distinct r.numero_serie_norm) from sf_registros r
         where r.pmo = o.pmo and r.op = o.op and r.posto = rt.ultimo_posto) as pecas_ultimo_posto,
       g.registros,
       to_char(g.primeiro at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') as primeiro_bipe,
       to_char(g.ultimo at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') as ultimo_bipe,
       coalesce(a.entradas, 0) as almox_enviadas, coalesce(a.estornos, 0) as almox_estornos,
       o.integrar_compels
  from sf_ordens o
  join regs g on g.pmo = o.pmo and g.op = o.op
  left join rota rt on rt.ordem_id = o.id
  left join almox a on a.pmo = o.pmo and a.op = o.op
 where o.cliente not ilike 'TESTE%'
 order by o.op, o.pmo;
\copy (select * from v_ops) to '/tmp/ops-shopfloor.csv' with (format csv, header)
select count(*) as ops_exportadas, min(op) as menor_op, max(op) as maior_op from v_ops;
rollback;
