-- Massa do teste da 0164 + FOTO das funções ANTES da 0164 (roda depois de 0090/0093/0105/0157/0161
-- e antes da 0164). A foto (tabelas antes_*) é o que prova "N=1 idêntico": o teste compara a saída
-- nova com a antiga, linha a linha, para as OPs de N=1.
\set ON_ERROR_STOP on

-- Cada OP existe em par: <X>50 (placas_por_painel = 50) e <X>1 (N = 1), com os MESMOS registros.
insert into public.sf_ordens (pmo, op, qtd, placas_por_painel) values
  ('PMO1','A50',5000,50), ('PMO1','A1',100,1), ('PMO1','B50',5000,50), ('PMO1','B1',100,1);
insert into public.sf_ordem_postos (ordem_id, posto, ordem)
  select id, p.posto, p.ordem from public.sf_ordens, (values ('MONT',1),('TESTE',2),('BURN',3)) as p(posto, ordem);

-- n linhas iguais (mesmo data_hora, mesma transação = mesmo bipe), como o sf_lancar grava um bipe
-- reprovado com n defeitos e o reparo grava uma linha por conserto.
create function pg_temp.reg(p_op text, p_posto text, p_sn text, p_status text, p_hora text, n int default 1)
returns void language sql as $func$
  insert into public.sf_registros (pmo, op, posto, status, numero_serie_norm, data_hora, codigo_defeito)
  select 'PMO1', p_op, p_posto, p_status, p_sn, ('2026-10-20 ' || p_hora || '-03')::timestamptz,
         case when n > 1 then 'D' || g else '' end
  from generate_series(1, n) g
$func$;

do $$
declare o text;
begin
  foreach o in array array['A50','A1'] loop
    -- P1: passagem, aprovado no teste, Burn-in entrada (status vazio) + saída aprovada.
    perform pg_temp.reg(o, 'MONT',  'P1', '',          '08:00');
    perform pg_temp.reg(o, 'TESTE', 'P1', 'Aprovado',  '09:00');
    perform pg_temp.reg(o, 'BURN',  'P1', '',          '10:00');
    perform pg_temp.reg(o, 'BURN',  'P1', 'Aprovado',  '11:00');
    -- P2: passagem e aprovado.
    perform pg_temp.reg(o, 'MONT',  'P2', '',          '08:01');
    perform pg_temp.reg(o, 'TESTE', 'P2', 'Aprovado',  '09:01');
    -- P3: reprovado com 2 linhas de defeito, reparo com 2 linhas, reteste aprovado.
    perform pg_temp.reg(o, 'MONT',  'P3', '',          '08:02');
    perform pg_temp.reg(o, 'TESTE', 'P3', 'Reprovado', '09:02', 2);
    perform pg_temp.reg(o, 'Manutenção', 'P3', '',     '09:10', 2);
    perform pg_temp.reg(o, 'TESTE', 'P3', 'Aprovado',  '09:20');
  end loop;
  foreach o in array array['B50','B1'] loop
    -- Q1: painel reprovado com 3 linhas de defeito, sem reteste.
    perform pg_temp.reg(o, 'MONT',  'Q1', '',          '08:00');
    perform pg_temp.reg(o, 'TESTE', 'Q1', 'Reprovado', '09:00', 3);
    -- Reparo do Q1 com 3 consertos (3 linhas no mesmo instante), sem reteste ainda.
    perform pg_temp.reg(o, 'Manutenção', 'Q1', '',     '09:15', 3);
    -- Linha sem SN: entra em `bipes`, fica fora das contagens por peça.
    perform pg_temp.reg(o, 'TESTE', '',   'Aprovado',  '09:30');
  end loop;
end $$;

-- ---------------- Foto ANTES da 0164 ----------------
create table public.antes_totais as
  select o.op, public.sf_dashboard_totais(p_op => o.op, p_status_op => '') as v
  from (values ('A50'),('A1'),('B50'),('B1')) o(op);

create table public.antes_grade as
  select o.op as filtro, g.*
  from (values ('A50'),('A1'),('B50'),('B1')) o(op),
       lateral public.sf_dashboard_grade(p_op => o.op, p_status_op => '') g;

create table public.antes_fluxo_op as
  select o.op as alvo, f.*
  from (values ('A50'),('A1'),('B50'),('B1')) o(op), lateral public.sf_fluxo_op('PMO1', o.op) f;

create table public.antes_fluxo_periodo as
  select o.op as alvo, f.*
  from (values ('A50'),('A1'),('B50'),('B1')) o(op),
       lateral public.sf_fluxo_periodo('PMO1', o.op, '2026-10-20 00:00-03', '2026-10-21 00:00-03') f;

create table public.antes_producao as
  select o.op as alvo, p.posto, b.bucket, x.*
  from (values ('A50'),('A1'),('B50'),('B1')) o(op),
       (values ('MONT'),('TESTE'),('BURN'),('Manutenção')) p(posto),
       (values ('dia'),('hora')) b(bucket),
       lateral public.sf_producao_periodo('PMO1', o.op, p.posto, null, null, b.bucket) x;
