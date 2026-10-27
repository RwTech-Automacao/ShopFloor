-- Prova a 0164: Dashboard e Fluxo em placas por painel. Roda depois da massa (que tirou a foto das
-- funções ANTES da 0164) e da 0164.
--   * N=1: saída IDÊNTICA à foto antiga (linha a linha).
--   * N=50: peças = SNs distintos × 50; o que é "por bipe" (bipes, retestes, datas) não muda.
\set ON_ERROR_STOP on

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $func$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $func$;

create function pg_temp.tot(p_op text, k text) returns bigint language sql as $func$
  select (public.sf_dashboard_totais(p_op => p_op, p_status_op => '') ->> k)::bigint
$func$;
create function pg_temp.antes_tot(p_op text, k text) returns bigint language sql as $func$
  select (v ->> k)::bigint from public.antes_totais where op = p_op
$func$;
create function pg_temp.fo(p_op text, p_posto text) returns public.antes_fluxo_op language sql as $func$
  select p_op, f.* from public.sf_fluxo_op('PMO1', p_op) f where f.posto = p_posto
$func$;
create function pg_temp.fp(p_op text, p_posto text) returns public.antes_fluxo_periodo language sql as $func$
  select p_op, f.* from public.sf_fluxo_periodo('PMO1', p_op, '2026-10-20 00:00-03', '2026-10-21 00:00-03') f
  where f.posto = p_posto
$func$;
create function pg_temp.prod(p_op text, p_posto text, p_bucket text) returns int language sql as $func$
  select sum(qtd)::int from public.sf_producao_periodo('PMO1', p_op, p_posto, null, null, p_bucket)
$func$;
create function pg_temp.gr(p_op text, p_posto text) returns public.antes_grade language sql as $func$
  select p_op, g.* from public.sf_dashboard_grade(p_op => p_op, p_status_op => '') g where g.posto = p_posto
$func$;

-- ================= N=1: idêntico à foto =================
select pg_temp.confere(
  (select v from public.antes_totais where op = o) = public.sf_dashboard_totais(p_op => o, p_status_op => ''),
  'totais N=1 idêntico (' || o || '): antes ' || (select v::text from public.antes_totais where op = o)
    || ' depois ' || public.sf_dashboard_totais(p_op => o, p_status_op => '')::text)
from (values ('A1'),('B1')) x(o);

select pg_temp.confere(not exists (
  (select * from public.antes_grade where filtro in ('A1','B1'))
  except all
  (select o.op, g.* from (values ('A1'),('B1')) o(op), lateral public.sf_dashboard_grade(p_op => o.op, p_status_op => '') g)
) and not exists (
  (select o.op, g.* from (values ('A1'),('B1')) o(op), lateral public.sf_dashboard_grade(p_op => o.op, p_status_op => '') g)
  except all
  (select * from public.antes_grade where filtro in ('A1','B1'))
), 'grade N=1 idêntica');

select pg_temp.confere(not exists (
  (select * from public.antes_fluxo_op where alvo in ('A1','B1'))
  except all
  (select o.op, f.* from (values ('A1'),('B1')) o(op), lateral public.sf_fluxo_op('PMO1', o.op) f)
) and not exists (
  (select o.op, f.* from (values ('A1'),('B1')) o(op), lateral public.sf_fluxo_op('PMO1', o.op) f)
  except all
  (select * from public.antes_fluxo_op where alvo in ('A1','B1'))
), 'sf_fluxo_op N=1 idêntico');

select pg_temp.confere(not exists (
  (select * from public.antes_fluxo_periodo where alvo in ('A1','B1'))
  except all
  (select o.op, f.* from (values ('A1'),('B1')) o(op),
     lateral public.sf_fluxo_periodo('PMO1', o.op, '2026-10-20 00:00-03', '2026-10-21 00:00-03') f)
) and not exists (
  (select o.op, f.* from (values ('A1'),('B1')) o(op),
     lateral public.sf_fluxo_periodo('PMO1', o.op, '2026-10-20 00:00-03', '2026-10-21 00:00-03') f)
  except all
  (select * from public.antes_fluxo_periodo where alvo in ('A1','B1'))
), 'sf_fluxo_periodo N=1 idêntico');

select pg_temp.confere(not exists (
  (select * from public.antes_producao where alvo in ('A1','B1'))
  except all
  (select o.op, p.posto, b.bucket, x.*
   from (values ('A1'),('B1')) o(op), (values ('MONT'),('TESTE'),('BURN'),('Manutenção')) p(posto),
        (values ('dia'),('hora')) b(bucket), lateral public.sf_producao_periodo('PMO1', o.op, p.posto, null, null, b.bucket) x)
) and not exists (
  (select o.op, p.posto, b.bucket, x.*
   from (values ('A1'),('B1')) o(op), (values ('MONT'),('TESTE'),('BURN'),('Manutenção')) p(posto),
        (values ('dia'),('hora')) b(bucket), lateral public.sf_producao_periodo('PMO1', o.op, p.posto, null, null, b.bucket) x)
  except all
  (select * from public.antes_producao where alvo in ('A1','B1'))
), 'sf_producao_periodo N=1 idêntico');

-- Sanidade da massa N=1 (o que a foto deveria conter): count(*) de linhas no TESTE = 5.
select pg_temp.confere((pg_temp.fp('A1','TESTE')).registros = 5, 'A1 TESTE registros (linhas) = 5');
select pg_temp.confere(pg_temp.prod('A1','TESTE','dia') = 5, 'A1 TESTE produção = 5');

-- ================= N=50: Dashboard =================
select pg_temp.confere(pg_temp.tot('A50','total') = 150, 'A50 total = 3 painéis x 50 = 150, deu ' || pg_temp.tot('A50','total'));
select pg_temp.confere(pg_temp.tot('A50','aprovado') = 150, 'A50 aprovado = 150');
select pg_temp.confere(pg_temp.tot('A50','reprovado') = 50, 'A50 reprovado = 50 (P3, 2 linhas de defeito)');
select pg_temp.confere(pg_temp.tot('A50','bipes') = 12 and pg_temp.tot('A50','bipes') = pg_temp.antes_tot('A50','bipes'), 'A50 bipes inalterado = 12 linhas');
select pg_temp.confere(pg_temp.tot('A50','ops') = 1, 'A50 ops = 1');
select pg_temp.confere(pg_temp.tot('B50','total') = 50, 'B50 total = 50 (linha sem SN fora)');
select pg_temp.confere(pg_temp.tot('B50','reprovado') = 50, 'B50 painel reprovado com 3 linhas = 50, deu ' || pg_temp.tot('B50','reprovado'));
select pg_temp.confere(pg_temp.tot('B50','aprovado') = 0, 'B50 aprovado = 0');
select pg_temp.confere(pg_temp.tot('B50','bipes') = 8 and pg_temp.tot('B50','bipes') = pg_temp.antes_tot('B50','bipes'), 'B50 bipes inalterado = 8 linhas');

select pg_temp.confere((pg_temp.gr('A50','MONT')).pecas_op = 150, 'grade A50 pecas_op = 150');
select pg_temp.confere((pg_temp.gr('A50','MONT')).sem_status = 150, 'grade A50 MONT sem_status = 150');
select pg_temp.confere((pg_temp.gr('A50','TESTE')).aprovados = 150 and (pg_temp.gr('A50','TESTE')).reprovados = 50, 'grade A50 TESTE 150 aprov / 50 reprov');
select pg_temp.confere((pg_temp.gr('A50','BURN')).aprovados = 50 and (pg_temp.gr('A50','BURN')).sem_status = 50, 'grade A50 BURN 50/50');
select pg_temp.confere((pg_temp.gr('A50','Manutenção')).sem_status = 50, 'grade A50 Manutenção 50 (2 linhas de reparo)');
select pg_temp.confere((pg_temp.gr('B50','TESTE')).reprovados = 50 and (pg_temp.gr('B50','TESTE')).aprovados = 0, 'grade B50 TESTE reprov 50');
select pg_temp.confere((select count(*) from public.sf_dashboard_grade(p_op => 'A50', p_status_op => '')) = 4, 'grade A50: 4 postos');

-- ================= N=50: sf_fluxo_op =================
select pg_temp.confere((pg_temp.fo('A50','TESTE')).wip = 100, 'A50 TESTE wip = 2 painéis x 50, deu ' || (pg_temp.fo('A50','TESTE')).wip);
select pg_temp.confere((pg_temp.fo('A50','BURN')).wip = 50, 'A50 BURN wip = 50');
select pg_temp.confere((pg_temp.fo('A50','TESTE')).passou_distinto = 150, 'A50 TESTE passou_distinto = 150');
select pg_temp.confere((pg_temp.fo('A50','MONT')).passou_distinto = 150, 'A50 MONT passou_distinto = 150');
select pg_temp.confere((pg_temp.fo('A50','Manutenção')).passou_distinto = 50, 'A50 Manutenção passou_distinto = 50 (2 linhas de reparo)');
select pg_temp.confere((pg_temp.fo('A50','TESTE')).aprovados_primeira = 100, 'A50 TESTE aprovados_primeira = 100');
select pg_temp.confere((pg_temp.fo('A50','BURN')).aprovados_primeira = 50, 'A50 BURN aprovados_primeira = 50');
select pg_temp.confere((pg_temp.fo('A50','TESTE')).aprovadas = 150, 'A50 TESTE aprovadas = 150');
-- Regra das linhas repetidas (ver 0164): com N>1 cada bipe vale exatamente `pecas`, por mais linhas
-- (defeito, conserto) que tenha. P3 reprovado com 2 linhas = 50.
select pg_temp.confere((pg_temp.fo('A50','TESTE')).reprovadas = 50, 'A50 TESTE reprovadas = 50, deu ' || (pg_temp.fo('A50','TESTE')).reprovadas);
select pg_temp.confere((pg_temp.fo('A50','TESTE')).registros = 200, 'A50 TESTE registros = 4 bipes x 50 = 200, deu ' || (pg_temp.fo('A50','TESTE')).registros);
select pg_temp.confere((pg_temp.fo('A50','BURN')).registros = 100, 'A50 BURN registros = entrada + saída = 100');
select pg_temp.confere((pg_temp.fo('A50','TESTE')).retestes = (select retestes from public.antes_fluxo_op where alvo='A50' and posto='TESTE'), 'A50 retestes inalterado');
select pg_temp.confere((pg_temp.fo('A50','TESTE')).primeiro_em = (select primeiro_em from public.antes_fluxo_op where alvo='A50' and posto='TESTE'), 'A50 primeiro_em inalterado');
select pg_temp.confere((pg_temp.fo('B50','Manutenção')).wip = 50, 'B50 painel reprovado aguarda na Manutenção = 50');
select pg_temp.confere((pg_temp.fo('B50','TESTE')).reprovados_sem_reteste = 50, 'B50 reprovados_sem_reteste = 50 (3 linhas, 1 painel)');
select pg_temp.confere((pg_temp.fo('B50','TESTE')).reprovadas = 50, 'B50 TESTE reprovadas = 1 painel (3 linhas) = 50');

-- ================= N=50: sf_fluxo_periodo e sf_producao_periodo =================
select pg_temp.confere((pg_temp.fp('A50','MONT')).registros = 150, 'A50 periodo MONT = 150');
select pg_temp.confere((pg_temp.fp('A50','TESTE')).registros = 200 and (pg_temp.fp('A50','TESTE')).aprovadas = 150
  and (pg_temp.fp('A50','TESTE')).reprovadas = 50, 'A50 periodo TESTE 200/150/50');
select pg_temp.confere((pg_temp.fp('B50','TESTE')).reprovadas = 50, 'B50 periodo TESTE reprovadas = 50 (3 linhas, 1 painel)');
select pg_temp.confere(pg_temp.prod('A50','MONT','dia') = 150, 'A50 produção MONT = 150');
select pg_temp.confere(pg_temp.prod('A50','TESTE','dia') = 200, 'A50 produção TESTE = 200, deu ' || pg_temp.prod('A50','TESTE','dia'));
select pg_temp.confere(pg_temp.prod('A50','TESTE','hora') = 200, 'A50 produção TESTE por hora = 200');
select pg_temp.confere((select qtd from public.sf_producao_periodo('PMO1','A50','BURN',null,null,'hora') where rotulo = '20/10 11h') = 50, 'A50 BURN 11h = 50');
select pg_temp.confere(pg_temp.prod('A50','Manutenção','dia') = 50, 'A50 produção Manutenção = 50 (reparo de 2 linhas)');

-- Reparo de 3 consertos (3 linhas, mesmo data_hora) em OP N=50 = 1 painel = 50; com N=1 = 3, como hoje.
select pg_temp.confere((pg_temp.fo('B50','Manutenção')).registros = 50, 'B50 Manutenção registros = reparo de 3 consertos = 50, deu ' || (pg_temp.fo('B50','Manutenção')).registros);
select pg_temp.confere((pg_temp.fp('B50','Manutenção')).registros = 50, 'B50 periodo Manutenção = 50');
select pg_temp.confere(pg_temp.prod('B50','Manutenção','dia') = 50, 'B50 produção Manutenção = 50');
select pg_temp.confere(pg_temp.prod('B1','Manutenção','dia') = 3, 'B1 produção Manutenção = 3 linhas (como hoje)');

\echo placas_dashboard_fluxo_test: tudo certo
