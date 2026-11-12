-- Casos de número de série por OP — SÓ LEITURA (begin ... rollback).
-- Pergunta: dentro de uma PMO/família, as OPs usam o MESMO SN, SNs DIFERENTES ligados (integração placa→produto),
-- ou SNs diferentes SEM ligação? E bipe sem SN (caixa/lote)? Uma linha por OP + os pares de OPs que dividem SN.
\set ON_ERROR_STOP on
begin;
create temp table sn on commit drop as
select distinct r.pmo, r.op, r.numero_serie_norm as sn
  from sf_registros r join sf_ordens o on o.pmo = r.pmo and o.op = r.op
 where r.numero_serie_norm <> '' and o.cliente not ilike 'TESTE%';
create index on sn (sn);

\echo '=== 1) por OP: faixa, SNs, bipes sem SN, SN dividido com outra OP, integração'
select o.pmo, o.op, o.qtd, o.placas_por_painel as ppp,
       (select count(*) from sf_ordem_faixas f where f.ordem_id = o.id) as faixas,
       o.sn_ini, o.sn_fim,
       (select count(*) from sn where sn.pmo = o.pmo and sn.op = o.op) as sns,
       (select count(*) from sf_registros r where r.pmo = o.pmo and r.op = o.op and r.numero_serie_norm = '') as bipes_sem_sn,
       (select string_agg(x.op || '/' || x.pmo || ':' || x.n, ' ') from (
          select b.op, b.pmo, count(*) n from sn a join sn b on b.sn = a.sn and (b.op, b.pmo) <> (a.op, a.pmo)
           where a.pmo = o.pmo and a.op = o.op group by 1, 2) x) as mesmo_sn_em,
       (select count(*) from sf_integracoes i where i.pmo = o.pmo and i.op = o.op and i.status = 'ATIVA') as integ_como_produto,
       (select string_agg(distinct it.placa_op || '/' || it.placa_pmo, ' ') from sf_integracoes i
          join sf_integracao_itens it on it.integracao_id = i.id
         where i.pmo = o.pmo and i.op = o.op and i.status = 'ATIVA') as placas_vem_de,
       (select string_agg(distinct i.op || '/' || i.pmo, ' ') from sf_integracao_itens it
          join sf_integracoes i on i.id = it.integracao_id
         where it.placa_pmo = o.pmo and it.placa_op = o.op and i.status = 'ATIVA') as vira_placa_em
  from sf_ordens o
 where o.cliente not ilike 'TESTE%'
   and exists (select 1 from sf_registros r where r.pmo = o.pmo and r.op = o.op)
 order by o.op, o.pmo;

\echo '=== 2) amostra de SN por OP (menor e maior bipado) para ver o formato'
select pmo, op, min(sn) as menor_sn, max(sn) as maior_sn, min(length(sn)) as tam_min, max(length(sn)) as tam_max
  from sn group by 1, 2 order by op, pmo;
rollback;
