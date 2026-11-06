-- Teste da 0173 contra as funções-base REAIS do Almoxarifado (sf_almox_necessidades_base e sf_almox_lotes_base,
-- 0167) e medição de custo em volume de produção. Roda no rodar-almoxarifado-test.sh com PLACAS=1 (rodar-placas-
-- almoxarifado-test.sh), DEPOIS da 0167 e da massa de almox_pendencias_base_massa.sql, na mesma base. O runner
-- aplica antes só as duas funções de leitura da 0173 (alerta_ficha_responsavel e alerta_ficha_novas, extraídas do
-- arquivo da migração) e uma tabela alerta_ficha_avisadas mínima; o resto da 0173 (alerta_avaliar) é testado no
-- rodar-alertas-test.sh (alertas_ficha_test.sql), que usa stubs das funções-base.
--
-- PARTE 1 (correção): sobre a massa inteira da suíte, o resultado de alerta_ficha_novas tem de ser EXATAMENTE a
-- união das duas bases nas OPs ativas dentro do piso (o filtro barato de "OPs que mexeram" não pode perder nada),
-- com produto/quantidade da OP/responsável certos.
-- PARTE 2 (custo): massa sintética em volume de produção, SEM ANALYZE, e a medição da função:
--   dia normal  = poucas OPs mexeram dentro do piso (o que o cron vê quase sempre);
--   pior caso   = TODAS as OPs ativas mexeram dentro do piso (piso de 30 dias: a base roda em todas).
-- Critério: <= 1,5 s. O limite de FALHA é 4,5 s (3 x: ruído do Docker); o tempo real é impresso (NOTICE "TEMPO").

\set ON_ERROR_STOP on
select set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $f$;

-- ---------- PARTE 1: correção sobre a massa da suíte ----------
do $t$
declare v_dif int; v_total int; v_cx int; v_lt int; v_resp int;
begin
  create temp table esperado on commit drop as
    select 'caixa'::text as tipo, o.pmo, o.op, n.codigo as chave, n.pecas, n.fechada_em as em
      from public.sf_ordens o
     cross join lateral public.sf_almox_necessidades_base(o.pmo, o.op) n
     where upper(btrim(coalesce(o.status, ''))) <> 'FINALIZADA' and n.fechada_em >= now() - interval '3 days'
    union all
    select 'lote', o.pmo, o.op, l.lote_id::text, l.pecas, l.aprovado_em
      from public.sf_ordens o
     cross join lateral public.sf_almox_lotes_base(o.pmo, o.op) l
     where upper(btrim(coalesce(o.status, ''))) <> 'FINALIZADA' and l.aprovado_em >= now() - interval '3 days';
  create temp table obtido on commit drop as
    select * from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 100000);

  select count(*) into v_total from esperado;
  select count(*) into v_cx from esperado where tipo = 'caixa';
  select count(*) into v_lt from esperado where tipo = 'lote';
  perform pg_temp.confere(v_cx >= 50 and v_lt >= 5, format('a massa nao tem caixas/lotes suficientes (%s caixas, %s lotes)', v_cx, v_lt));

  select count(*) into v_dif from (
    (select tipo, pmo, op, chave, pecas, em from esperado except all select tipo, pmo, op, chave, pecas, em from obtido)
    union all
    (select tipo, pmo, op, chave, pecas, em from obtido except all select tipo, pmo, op, chave, pecas, em from esperado)) x;
  perform pg_temp.confere(v_dif = 0, format('alerta_ficha_novas difere das duas bases em %s linha(s) (esperado %s)', v_dif, v_total));

  -- produto e quantidade da OP vêm de sf_ordens
  perform pg_temp.confere(not exists (
    select 1 from obtido b join public.sf_ordens o on o.pmo = b.pmo and o.op = b.op
     where b.produto is distinct from o.descricao or b.quantidade_op is distinct from o.qtd),
    'produto/quantidade da OP diferem de sf_ordens');

  -- responsável das caixas da massa (PMOMC1/9801): todo bipe tem colaborador 'Massa' no posto Embalagem
  select count(*) into v_resp from obtido where pmo = 'PMOMC1' and op = '9801' and responsavel = 'Massa';
  perform pg_temp.confere(v_resp >= 50, format('responsavel das caixas da massa = Massa em so %s linhas', v_resp));

  -- A MESMA origem da tela: o responsável da caixa é o `fechada_por` do sf_almox_detalhe (0165).
  perform pg_temp.confere(not exists (
    select 1 from obtido b
     where b.tipo = 'caixa' and b.pmo = 'PMOMC1' and b.op = '9801'
       and b.responsavel is distinct from (public.sf_almox_detalhe(b.pmo, b.op, b.chave)->>'fechada_por')),
    'o responsavel difere do fechada_por da tela do Almoxarifado (sf_almox_detalhe)');

  -- peça avulsa (PMOMA1/9803) nao gera ficha
  perform pg_temp.confere(not exists (select 1 from obtido where pmo = 'PMOMA1'), 'peca avulsa gerou ficha');
  -- lotes da PMOMI1/9802 aparecem, com rótulo LOTE[..][n]
  perform pg_temp.confere((select count(*) from obtido where pmo = 'PMOMI1' and op = '9802' and tipo = 'lote' and chave <> '' and codigo like 'LOTE[%][%]') = 6,
    'os 6 lotes da massa PMOMI1 nao aparecem como ficha');
  raise notice 'PARTE 1: alerta_ficha_novas = uniao das bases reais (% caixas, % lotes), responsavel = fechada_por da tela: ok', v_cx, v_lt;
end $t$;

-- OP finalizada e piso: a mesma massa com tudo finalizado não devolve nada.
begin;
update public.sf_ordens set status = 'FINALIZADA';
select count(*) as n from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 100) \gset
select pg_temp.confere(:n = 0, 'OP finalizada gerou ficha') \g /dev/null
rollback;

-- ---------- PARTE 2: custo em volume de produção ----------
-- Tempo (ms) de UMA execução, lido do EXPLAIN (ANALYZE, BUFFERS); imprime o plano se p_plano.
create function pg_temp.medir(p_rotulo text, p_desde text, p_plano boolean default false) returns numeric
language plpgsql as $f$
declare r text; v_ms numeric;
begin
  for r in execute format('explain (analyze, buffers) select * from public.alerta_ficha_novas(null, ''{}''::text[], now() - interval %L, 30)', p_desde) loop
    if p_plano then raise notice 'PLANO[%] %', p_rotulo, r; end if;
    if r like 'Execution Time:%' then v_ms := substring(r from 'Execution Time: ([0-9.]+) ms')::numeric; end if;
  end loop;
  raise notice 'TEMPO % : % ms', p_rotulo, v_ms;
  return v_ms;
end $f$;

alter table public.sf_caixas set (autovacuum_enabled = false);
alter table public.sf_ordens set (autovacuum_enabled = false);

-- Massa: 60 OPs coletivas + 20 individuais (com NQA) ATIVAS, 1.000 SNs x 8 postos cada (8 mil registros, como a OP
-- grande da medição do Almoxarifado) e 100 OPs FINALIZADAS de 2 mil registros. Das ativas, 1 em cada 12 "mexeu"
-- (caixa fechada / lote aprovado há minutos); as outras pararam há 10 dias. Nada de analyze: é o estado de uma
-- OP nova, em que o planejador não tem estatística (a lição da 0167).
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd, descricao)
select 'PMOF' || lpad(g::text, 3, '0'), 'F' || lpad(g::text, 4, '0'), 'Cliente F', '1', '1000',
       g > 60 and g <= 80, case when g <= 80 then 'EM PRODUCAO' else 'FINALIZADA' end, 1000, 'PLACA MASSA ' || g
  from generate_series(1, 180) g;
do $t$ declare r record; begin
  for r in select pmo, op, embalagem_individual as ind from public.sf_ordens where pmo like 'PMOF%' and status = 'EM PRODUCAO' loop
    perform public.teste_op_postos(r.pmo, r.op, case when r.ind then array['Embalagem', 'Inspeção NQA', 'Almoxarifado']
                                                     else array['Embalagem', 'Almoxarifado'] end);
  end loop;
end $t$;

-- 8 postos x 1.000 SNs nas ativas; o NQA das individuais carrega o nqa_lote_id (10 lotes de 100)
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, status, data_hora, nqa_lote_id)
select 'Massa', p.posto, o.pmo, o.op, 'Cliente F',
       case when p.posto = 'Embalagem' and not o.embalagem_individual then 'CX[' || ((s - 1) / 20 + 1) || '][20]' || o.op || '-' || o.pmo else '' end,
       o.op || '-' || s, o.op || '-' || s, 'Aprovado',
       case when (substr(o.pmo, 5)::int % 12) = 0 then now() - make_interval(mins => 30) + make_interval(secs => s)
            else now() - interval '10 days' + make_interval(secs => s) end,
       case when p.posto = 'Inspeção NQA' and o.embalagem_individual
            then md5(o.op || ((s - 1) / 100)::text)::uuid end
  from public.sf_ordens o
 cross join generate_series(1, 1000) s
 cross join (values ('Posto1'), ('Posto2'), ('Posto3'), ('Posto4'), ('Posto5'), ('Inspeção NQA'), ('Posto7'), ('Embalagem')) p(posto)
 where o.pmo like 'PMOF%' and o.status = 'EM PRODUCAO'
   and (p.posto <> 'Inspeção NQA' or o.embalagem_individual);
-- finalizadas: volume de fundo (2 mil registros cada), recentes de propósito (o piso não deve ser o que as esconde)
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, status, data_hora)
select 'Massa', 'Posto1', o.pmo, o.op, 'Cliente F', o.op || '-' || s, o.op || '-' || s, 'Aprovado', now() - make_interval(mins => 5)
  from public.sf_ordens o cross join generate_series(1, 2000) s
 where o.pmo like 'PMOF%' and o.status = 'FINALIZADA';

-- caixas das coletivas: 50 caixas de 20, fechadas junto da movimentação (recentes ou de 10 dias atrás)
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
select o.pmo, o.op, 'Embalagem', s, 20, 20, 'CX[' || s || '][20]' || o.op || '-' || o.pmo, true, 0,
       case when (substr(o.pmo, 5)::int % 12) = 0 then now() - interval '20 minutes' else now() - interval '10 days' end
  from public.sf_ordens o cross join generate_series(1, 50) s
 where o.pmo like 'PMOF%' and o.status = 'EM PRODUCAO' and not o.embalagem_individual;

do $t$ begin
  perform pg_temp.confere((select count(*) from public.sf_registros where pmo like 'PMOF%') > 700000,
    'a massa nao tem o volume esperado de registros');
  -- a massa precisa render ficha, senão o tempo não prova nada
  perform pg_temp.confere((select count(*) from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '3 days', 1000) where pmo like 'PMOF%') >= 100,
    'dia normal: a massa nao rende fichas');
  perform pg_temp.confere((select count(*) from public.alerta_ficha_novas(null, '{}'::text[], now() - interval '30 days', 100000) where pmo like 'PMOF%') >= 3000,
    'pior caso: a massa nao rende fichas (esperava ~3.000 caixas + lotes)');
end $t$;

create temp table medidas_ficha (rotulo text, ms numeric);
insert into medidas_ficha select 'dia normal, 1a execucao (sem analyze)', pg_temp.medir('dia normal 1a', '3 days', true);
insert into medidas_ficha select 'dia normal, 2a execucao', pg_temp.medir('dia normal 2a', '3 days');
insert into medidas_ficha select 'dia normal, 3a execucao', pg_temp.medir('dia normal 3a', '3 days');
insert into medidas_ficha select 'pior caso (todas as OPs mexeram), 1a execucao', pg_temp.medir('pior caso 1a', '30 days', true);
insert into medidas_ficha select 'pior caso, 2a execucao', pg_temp.medir('pior caso 2a', '30 days');
insert into medidas_ficha select 'pior caso, 3a execucao', pg_temp.medir('pior caso 3a', '30 days');

do $t$
declare v_normal numeric; v_pior numeric;
begin
  select max(ms) into v_normal from medidas_ficha where rotulo like 'dia normal%';
  select max(ms) into v_pior from medidas_ficha where rotulo like 'pior caso%';
  raise notice 'TEMPO RESUMO: dia normal = % ms, pior caso = % ms (criterio 1500 ms; falha acima de 4500 ms)', round(v_normal, 1), round(v_pior, 1);
  if v_normal > 4500 or v_pior > 4500 then
    raise exception 'FALHOU (desempenho): alerta_ficha_novas levou % ms (dia normal) / % ms (pior caso); limite 4500 ms', v_normal, v_pior;
  end if;
end $t$;
