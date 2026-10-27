-- Prova a 0162: progresso/finalização da OP em placas. Roda depois de 0036, 0121, 0145, 0148, 0161, 0162.
\set ON_ERROR_STOP on

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $func$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $func$;

create function pg_temp.pct(p_op text) returns numeric language sql as $func$
  select pct_conclusao from public.sf_ops_com_bipes(null, null) where op = p_op
$func$;
create function pg_temp.conc(p_op text) returns bigint language sql as $func$
  select concluidas from public.sf_ordem_resumo where op = p_op
$func$;
create function pg_temp.sn(p_op text, n int, p_status text default 'aprovado', p_ini int default 1) returns void language sql as $func$
  insert into public.sf_registros (pmo, op, posto, status, numero_serie_norm)
  select 'PMO1', p_op, 'EMB', p_status, p_op || '-SN' || g from generate_series(p_ini, p_ini + n - 1) g
$func$;

-- A: N=50, qtd 5000. B: N=50, qtd 5000. C: N=1, qtd 100. D: N=50 qtd 5000 com rebipe. E: N=50, finalização.
insert into public.sf_ordens (pmo, op, qtd, status, placas_por_painel) values
  ('PMO1','A',5000,'ATIVA',50), ('PMO1','B',5000,'ATIVA',50), ('PMO1','C',100,'ATIVA',1),
  ('PMO1','D',5000,'ATIVA',50), ('PMO1','E',5000,'ATIVA',50);
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
  select id, p.posto, p.ordem from public.sf_ordens, (values ('MONT',1),('EMB',2)) as p(posto, ordem);

select pg_temp.sn('A', 100);                 -- 100 SNs x 50 = 5000
select pg_temp.sn('B', 50);                  -- 50 SNs x 50 = 2500 -> 50%
select pg_temp.sn('C', 100);                 -- N=1
-- D: 50 SNs, cada um com reprovado + aprovado + aprovado de novo (rebipe) = 3 linhas por SN
select pg_temp.sn('D', 50, 'reprovado');
select pg_temp.sn('D', 50);
select pg_temp.sn('D', 50);

select pg_temp.confere((select pecas from public.sf_registros where op='A' limit 1) = 50, 'trigger deveria gravar pecas=50');
select pg_temp.confere(pg_temp.pct('A') = 100.0, 'A: 100 SNs x 50 deveria dar 100%, deu ' || coalesce(pg_temp.pct('A')::text,'nulo'));
select pg_temp.confere(pg_temp.conc('A') = 5000, 'A: concluidas deveria ser 5000, deu ' || coalesce(pg_temp.conc('A')::text,'nulo'));
select pg_temp.confere(pg_temp.pct('B') = 50.0, 'B: 50%, deu ' || coalesce(pg_temp.pct('B')::text,'nulo'));
select pg_temp.confere(pg_temp.conc('B') = 2500, 'B: concluidas 2500');
select pg_temp.confere(pg_temp.pct('C') = 100.0 and pg_temp.conc('C') = 100, 'C (N=1): 100% e 100');
select pg_temp.confere(pg_temp.pct('D') = 50.0, 'D: SN repetido conta uma vez -> 50%, deu ' || coalesce(pg_temp.pct('D')::text,'nulo'));
select pg_temp.confere(pg_temp.conc('D') = 2500, 'D: concluidas 2500 (SN repetido uma vez)');
select pg_temp.confere((select bipes from public.sf_ops_com_bipes(null,null) where op='D') = 150, 'D: bipes continua count(*) = 150');
select pg_temp.confere((select bipes from public.sf_ops_com_bipes(null,null) where op='A') = 100, 'A: bipes = 100');

-- Finalização: E fica em 50% -> não fecha; chega a 100% -> fecha; perde bipes -> reabre.
select pg_temp.sn('E', 50);
select public.sf_sincronizar_finalizacao();
select pg_temp.confere((select status from public.sf_ordens where op='E') = 'ATIVA', 'E a 50% fica ATIVA');
select pg_temp.confere((select status from public.sf_ordens where op='A') = 'FINALIZADA', 'A a 100% finaliza');
select pg_temp.confere((select status from public.sf_ordens where op='D') = 'ATIVA', 'D a 50% fica ATIVA');
select pg_temp.confere((select status from public.sf_ordens where op='C') = 'FINALIZADA', 'C (N=1) a 100% finaliza');
select pg_temp.sn('E', 50, 'aprovado', 51);
select public.sf_sincronizar_finalizacao();
select pg_temp.confere((select status from public.sf_ordens where op='E') = 'FINALIZADA', 'E a 100% finaliza');
delete from public.sf_registros where op='E' and numero_serie_norm in ('E-SN1','E-SN2');
select public.sf_sincronizar_finalizacao();
select pg_temp.confere((select status from public.sf_ordens where op='E') = 'ATIVA', 'E abaixo de 100% reabre');
\echo placas_progresso_test: tudo certo
