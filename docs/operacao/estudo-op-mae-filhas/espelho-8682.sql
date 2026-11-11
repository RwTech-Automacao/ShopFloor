-- Espelho da produção da OP 8682 (placas) / 8682_F (fonte) no ShopFloor — SÓ LEITURA (begin ... rollback).
-- Estudo: Compels tem 8682 PMOF52 (mãe) → 8683 PRT706 (PTH) e 8684 PRT705 (SMT). Aqui vemos como o
-- ShopFloor registrou a mesma produção: OPs, rota, componentes e, por posto, quando começou e terminou.
\set ON_ERROR_STOP on
begin;
create temp table ops on commit drop as
select id, pmo, op, qtd, status, sn_ini, sn_fim, created_at, integrar_compels
  from sf_ordens where op ~ '^868[2-4]';

\echo '=== 1) OPs no ShopFloor (868x)'
select pmo, op, qtd, status, sn_ini, sn_fim, integrar_compels,
       to_char(created_at at time zone 'America/Sao_Paulo', 'DD/MM/YY HH24:MI') as criada
  from ops order by op, pmo;

\echo '=== 2) rota de cada OP (ordem, posto, perfil)'
select o.pmo, o.op, p.ordem, p.posto, coalesce(s.perfil, '-') as perfil, coalesce(pp.recurso, '-') as recurso
  from ops o join sf_ordem_postos p on p.ordem_id = o.id
  left join sf_postos s on s.chave = p.posto left join sf_posto_perfis pp on pp.chave = s.perfil
 order by o.op, p.ordem;

\echo '=== 3) componentes declarados (sf_ordem_componentes)'
select o.pmo, o.op, c.pmo_componente, c.posto
  from ops o join sf_ordem_componentes c on c.ordem_id = o.id order by o.op, c.posto;

\echo '=== 4) por posto: pecas, registros, aprovadas/reprovadas, 1o e ultimo bipe, colaboradores'
select r.pmo, r.op, r.posto,
       count(distinct r.numero_serie_norm) as pecas, count(*) as registros,
       count(*) filter (where r.status ilike 'aprov%') as aprov, count(*) filter (where r.status ilike 'reprov%') as reprov,
       to_char(min(r.data_hora) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as primeiro,
       to_char(max(r.data_hora) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as ultimo,
       count(distinct r.colaborador) as colabs
  from sf_registros r join ops o on o.pmo = r.pmo and o.op = r.op
 group by 1, 2, 3
 order by r.op, min(r.data_hora);

\echo '=== 5) por dia e posto: pecas distintas (curva de producao)'
select r.op, r.posto, to_char(r.data_hora at time zone 'America/Sao_Paulo', 'DD/MM') as dia,
       count(distinct r.numero_serie_norm) as pecas
  from sf_registros r join ops o on o.pmo = r.pmo and o.op = r.op
 group by r.op, r.posto, dia, (r.data_hora at time zone 'America/Sao_Paulo')::date
 order by r.op, (r.data_hora at time zone 'America/Sao_Paulo')::date, r.posto;

\echo '=== 6) integracoes (placa -> fonte) por dia'
select i.op, i.status, to_char(i.data_hora at time zone 'America/Sao_Paulo', 'DD/MM') as dia, count(distinct i.id) as integracoes,
       count(it.id) as placas,
       string_agg(distinct it.placa_pmo || '/' || it.placa_op, ', ') as placas_de
  from sf_integracoes i join (select distinct op from ops) o on o.op = i.op
  left join sf_integracao_itens it on it.integracao_id = i.id
 group by i.op, i.status, dia, (i.data_hora at time zone 'America/Sao_Paulo')::date
 order by i.op, (i.data_hora at time zone 'America/Sao_Paulo')::date;

\echo '=== 7) Almoxarifado -> Compels (sf_estoque_envios)'
select e.op, e.operacao, e.tipo, count(*) as linhas, sum(e.quantidade) as pecas,
       count(*) filter (where e.ok) as enviadas, count(*) filter (where e.cancelado_em is not null) as canceladas,
       to_char(min(e.criado_em) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as primeira,
       to_char(max(e.enviado_em) at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') as ultimo_envio
  from sf_estoque_envios e where e.op ~ '^868[2-4]'
 group by 1, 2, 3 order by 1, 2;
rollback;
