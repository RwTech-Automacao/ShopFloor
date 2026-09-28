-- Métricas das OPs PMOC50/8504 (placas) e PMOC50_/8504_ (produto) — SÓ LEITURA (usa tabelas temporárias da sessão).
-- Rodar: psql "$RDS" -f relatorio-op-8504.sql > relatorio-8504.txt
\pset pager off
\pset border 2
\pset footer off
set timezone = 'America/Sao_Paulo';
create temp table ops(pmo text, op text);
insert into ops values ('PMOC50','8504'), ('PMOC50_','8504_');
create temp table r as select r.* from sf_registros r join ops using (pmo, op);
create temp table po as
  select o.pmo, o.op, p.posto, p.ordem from sf_ordens o join ops using (pmo, op) join sf_ordem_postos p on p.ordem_id = o.id;

\echo '=== 1) DADOS PRODUTIVOS ==='
select o.pmo, o.op, o.qtd as qtd_op,
       (select count(distinct numero_serie_norm) from r where r.pmo = o.pmo and r.op = o.op) as pecas_com_lancamento,
       (select count(*) from r where r.pmo = o.pmo and r.op = o.op) as lancamentos,
       (select count(distinct r.numero_serie_norm) from r join po on po.pmo = r.pmo and po.op = r.op and po.posto = r.posto
         where r.pmo = o.pmo and r.op = o.op
           and po.ordem = (select max(ordem) from po p2 where p2.pmo = o.pmo and p2.op = o.op)
           and lower(r.status) <> 'reprovado') as concluidas_ultimo_posto,
       (select to_char(min(data_hora), 'DD/MM/YYYY HH24:MI') from r where r.pmo = o.pmo and r.op = o.op) as inicio,
       (select to_char(max(data_hora), 'DD/MM/YYYY HH24:MI') from r where r.pmo = o.pmo and r.op = o.op) as fim
from sf_ordens o join ops using (pmo, op) order by o.pmo;

\echo '=== 2a) REPROVACAO GERAL (pecas reprovadas ao menos 1 vez em qualquer posto) ==='
select pmo, op, count(distinct numero_serie_norm) as pecas,
       count(distinct numero_serie_norm) filter (where lower(status) = 'reprovado') as pecas_reprovadas,
       round(100.0 * count(distinct numero_serie_norm) filter (where lower(status) = 'reprovado') / nullif(count(distinct numero_serie_norm), 0), 2) as pct_reprovacao,
       count(distinct numero_serie_norm) filter (where posto = 'Manutenção') as pecas_na_manutencao
from r group by pmo, op order by pmo;

\echo '=== 2b) REPROVACAO POR POSTO (ordem do fluxo) ==='
select po.pmo, po.op, po.ordem, po.posto,
       count(distinct r.numero_serie_norm) as pecas,
       count(distinct r.numero_serie_norm) filter (where lower(r.status) = 'reprovado') as pecas_reprovadas,
       round(100.0 * count(distinct r.numero_serie_norm) filter (where lower(r.status) = 'reprovado') / nullif(count(distinct r.numero_serie_norm), 0), 2) as pct,
       count(*) filter (where lower(r.status) = 'reprovado') as bipes_reprovados
from po left join r on r.pmo = po.pmo and r.op = po.op and r.posto = po.posto
group by po.pmo, po.op, po.ordem, po.posto order by po.pmo, po.ordem;

\echo '=== 3a) MAIORES OFENSORES GERAIS (top 3 defeitos nas reprovas) ==='
with d as (
  select pmo, op, btrim(codigo_defeito) as defeito, count(*) as vezes, count(distinct numero_serie_norm) as pecas
  from r where lower(status) = 'reprovado' and btrim(coalesce(codigo_defeito, '')) <> '' group by 1, 2, 3),
k as (select *, row_number() over (partition by pmo, op order by vezes desc, defeito) as rk from d)
select pmo, op, rk, defeito, vezes, pecas from k where rk <= 3 order by pmo, rk;

\echo '=== 3b) MAIORES OFENSORES POR POSTO (top 3) ==='
with d as (
  select pmo, op, posto, btrim(codigo_defeito) as defeito, count(*) as vezes, count(distinct numero_serie_norm) as pecas
  from r where lower(status) = 'reprovado' and btrim(coalesce(codigo_defeito, '')) <> '' group by 1, 2, 3, 4),
k as (select *, row_number() over (partition by pmo, op, posto order by vezes desc, defeito) as rk from d)
select pmo, op, posto, rk, defeito, vezes, pecas from k where rk <= 3 order by pmo, posto, rk;

\echo '=== 4a) TEMPO DE FABRICACAO GERAL (1o ao ultimo lancamento da peca, em horas) ==='
with p as (select pmo, op, numero_serie_norm, extract(epoch from max(data_hora) - min(data_hora)) / 3600.0 as h
           from r group by 1, 2, 3 having count(*) > 1)
select pmo, op, count(*) as pecas, round(avg(h)::numeric, 1) as media_h,
       round((percentile_cont(0.5) within group (order by h))::numeric, 1) as mediana_h,
       round(min(h)::numeric, 1) as min_h, round(max(h)::numeric, 1) as max_h
from p group by pmo, op order by pmo;

\echo '=== 4b) TEMPO POR POSTO: espera desde o posto anterior (mediana, minutos) + ritmo do posto (seg/peca, pausas > 30 min descartadas) ==='
with primeiro as (
  select r.pmo, r.op, r.numero_serie_norm, r.posto, po.ordem, min(r.data_hora) as t
  from r join po on po.pmo = r.pmo and po.op = r.op and po.posto = r.posto group by 1, 2, 3, 4, 5),
lead as (
  select *, extract(epoch from t - lag(t) over (partition by pmo, op, numero_serie_norm order by ordem)) / 60.0 as espera_min from primeiro),
bip as (select distinct pmo, op, posto, data_hora from r),
ritmo as (
  select pmo, op, posto, extract(epoch from data_hora - lag(data_hora) over (partition by pmo, op, posto order by data_hora)) as seg from bip)
select l.pmo, l.op, l.ordem, l.posto,
       round((percentile_cont(0.5) within group (order by l.espera_min))::numeric, 1) as espera_mediana_min,
       (select round(avg(seg)::numeric, 0) from ritmo x where x.pmo = l.pmo and x.op = l.op and x.posto = l.posto and seg <= 1800) as ritmo_seg_por_peca
from lead l group by l.pmo, l.op, l.ordem, l.posto order by l.pmo, l.ordem;

\echo '=== 5) LANCAMENTOS ERRADOS (cancelados / todos os lancamentos, por posto) ==='
with c as (select c.pmo, c.op, c.posto, count(*) as cancelados from sf_registros_cancelados c join ops using (pmo, op) group by 1, 2, 3),
v as (select pmo, op, posto, count(*) as vivos from r group by 1, 2, 3)
select coalesce(v.pmo, c.pmo) as pmo, coalesce(v.op, c.op) as op, coalesce(v.posto, c.posto) as posto,
       coalesce(v.vivos, 0) + coalesce(c.cancelados, 0) as lancamentos, coalesce(c.cancelados, 0) as cancelados,
       round(100.0 * coalesce(c.cancelados, 0) / nullif(coalesce(v.vivos, 0) + coalesce(c.cancelados, 0), 0), 2) as pct_errados
from v full join c on c.pmo = v.pmo and c.op = v.op and c.posto = v.posto
order by 1, 5 desc, 3;
\echo '--- total por OP + integracoes canceladas ---'
select o.pmo, o.op,
       (select count(*) from sf_registros_cancelados c where c.pmo = o.pmo and c.op = o.op) as lancamentos_cancelados,
       (select count(*) from r where r.pmo = o.pmo and r.op = o.op) + (select count(*) from sf_registros_cancelados c where c.pmo = o.pmo and c.op = o.op) as lancamentos_total,
       (select count(*) from sf_integracoes i where i.pmo = o.pmo and i.op = o.op and i.status = 'CANCELADA') as integracoes_canceladas,
       (select count(*) from sf_integracoes i where i.pmo = o.pmo and i.op = o.op) as integracoes_total
from ops o order by o.pmo;

\echo '=== 6) HISTORICO DE CANCELAMENTOS DE LANCAMENTO ==='
select to_char(c.cancelado_em, 'DD/MM HH24:MI') as cancelado_em, c.pmo, c.op, c.posto, c.numero_serie_norm as sn,
       coalesce(nullif(c.dados->>'status', ''), '—') as status_original,
       to_char((c.dados->>'data_hora')::timestamptz, 'DD/MM HH24:MI') as lancado_em,
       c.motivo, coalesce(u.nome, u.email, '?') as cancelado_por
from sf_registros_cancelados c join ops using (pmo, op) left join usuarios u on u.id = c.cancelado_por
order by c.cancelado_em;

\echo '=== 7) INTEGRACOES CANCELADAS ==='
select to_char(i.cancelada_em, 'DD/MM HH24:MI') as cancelada_em, i.produto_sn, i.codigo,
       coalesce(i.cancelada_por, '?') as por, coalesce(i.cancelada_motivo, '(sem motivo — antes de 21/09)') as motivo
from sf_integracoes i join ops using (pmo, op) where i.status = 'CANCELADA' order by i.cancelada_em;

\echo '=== 8) INTERVENCOES MANUAIS (ajustes feitos por SQL) ==='
select 'integracao por hipotese' as tipo, i.produto_sn as sn, i.codigo as referencia, to_char(i.data_hora, 'DD/MM HH24:MI') as data, left(i.observacao, 80) as detalhe
from sf_integracoes i join ops using (pmo, op) where i.observacao like '*%'
union all
select 'registro "Ajuste de sistema"', r.numero_serie_norm, r.posto, to_char(r.data_hora, 'DD/MM HH24:MI'), left(coalesce(r.observacao, ''), 80)
from r where r.colaborador = 'Ajuste de sistema'
order by 1, 2;

\echo '=== 9) CAIXAS REPROVADAS NO NQA (remontagens) ==='
select c.pmo, c.op, c.seq, c.revisao, c.codigo, c.qtd from sf_caixas c join ops using (pmo, op) where c.revisao > 0 order by c.seq, c.revisao;
