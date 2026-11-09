-- Medição da 0167: o custo de sf_almox_pendencias_base(), que o cron do alerta de parado roda a cada
-- 5 minutos sobre TODAS as OPs ativas. Critério: <= 300 ms por OP de 10 mil registros (a tela do
-- Almoxarifado, que faz o mesmo cálculo, mediu ~121 ms em produção em 23/10).
-- Roda no rodar-almoxarifado-test.sh com PLACAS=1, DEPOIS da 0167 e do almox_pendencias_base_test.sql,
-- na mesma base (usa teste_op_postos e teste_lote da suíte). Modelo: nqa_caixa_plano_test.sql — OPs NOVAS e
-- GRANDES, SEM ANALYZE (o planejador não as conhece; foi isso que derrubou o NQA em 22/10), e o
-- autovacuum da tabela desligado para a estatística continuar velha de forma determinística.
--
-- Massa (3 OPs, cada uma com 1.250 SNs x 8 postos = 10.000 registros):
--   PMOMC1/9801  coletiva, 60 caixas fechadas de 20 na Embalagem, 10 com entrada no Almoxarifado
--   PMOMI1/9802  individual com NQA anterior: 6 lotes aprovados (dois com entrada) e uma fila de peças
--   PMOMA1/9803  individual com Embalagem anterior: ~1.100 peças avulsas esperando
-- Resultado: cada OP deve devolver as linhas esperadas (a medição só vale se a função devolve a massa).
--
-- LIMITE DE FALHA = 900 ms POR OP (3 x o critério de 300 ms): o Postgres em Docker no notebook tem
-- ruído grande (CPU compartilhada, disco overlay), e este teste não pode ficar vermelho por barulho.
-- O número real é impresso (NOTICE "TEMPO") e vai para o relatório; o critério de 300 ms é lido
-- em cima dele, não do limite de falha. O tempo por OP vem de medições isoladas (as outras OPs FINALIZADAS numa transação desfeita).

\set ON_ERROR_STOP on
select set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);

create index if not exists sf_registros_ordem_sn on public.sf_registros (pmo, op, numero_serie_norm);
create index if not exists sf_registros_caixa    on public.sf_registros (pmo, op, posto, numero_caixa);
create index if not exists sf_registros_sn_norm  on public.sf_registros (numero_serie_norm);
alter table public.sf_registros set (autovacuum_enabled = false);

-- Tempo (ms) de UMA execução da base, lido do EXPLAIN (ANALYZE, BUFFERS); imprime o plano se p_plano.
create function pg_temp.medir(p_rotulo text, p_plano boolean default false) returns numeric
language plpgsql as $f$
declare r text; v_ms numeric;
begin
  for r in execute 'explain (analyze, buffers) select * from public.sf_almox_pendencias_base()' loop
    if p_plano then raise notice 'PLANO[%] %', p_rotulo, r; end if;
    if r like 'Execution Time:%' then
      v_ms := substring(r from 'Execution Time: ([0-9.]+) ms')::numeric;
    end if;
  end loop;
  raise notice 'TEMPO % : % ms', p_rotulo, v_ms;
  return v_ms;
end $f$;

-- Sem a massa grande (só o resto da suíte): a linha de base.
create temp table medidas (rotulo text, ms numeric);
insert into medidas select 'base sem massa grande', pg_temp.medir('base sem massa grande');

-- ---------- massa ----------
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd) values
  ('PMOMC1', '9801', 'Cliente Massa', '800000', '801250', false, 'EM PRODUCAO', 1250),
  ('PMOMI1', '9802', 'Cliente Massa', '810000', '811250', true,  'EM PRODUCAO', 1250),
  ('PMOMA1', '9803', 'Cliente Massa', '820000', '821250', true,  'EM PRODUCAO', 1250);
do $t$ begin
  perform public.teste_op_postos('PMOMC1', '9801', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOMI1', '9802', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMOMA1', '9803', array['Embalagem', 'Almoxarifado']);
end $t$;

-- 1.250 SNs x 8 postos por OP. Na coletiva a Embalagem carimba a caixa de 20 (CX[n][20]OP-PMO);
-- nas individuais o carimbo é o próprio SN.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, data_hora)
select 'Massa', p.posto, o.pmo, o.op, 'Cliente Massa',
       case when p.posto <> 'Embalagem' then ''
            when o.pmo = 'PMOMC1' then 'CX[' || ((i - 1) / 20 + 1)::text || '][20]' || o.op || '-' || o.pmo
            else (o.base + i)::text end,
       (o.base + i)::text, (o.base + i)::text,
       now() - make_interval(mins => 900 - p.ord * 10) + make_interval(secs => i)
from (values ('PMOMC1', '9801', 800000), ('PMOMI1', '9802', 810000), ('PMOMA1', '9803', 820000)) o(pmo, op, base),
     generate_series(1, 1250) i,
     (values ('Posto1',1),('Posto2',2),('Posto3',3),('Posto4',4),('Posto5',5),('Posto6',6),('Posto7',7),('Embalagem',8)) p(posto, ord);

-- PMOMC1: 62 caixas de 20 (as 1.250 peças), 60 fechadas; a entrada no Almoxarifado das 10 primeiras.
insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
select 'PMOMC1', '9801', 'Embalagem', s, 20, case when s = 63 then 10 else 20 end,
       'CX[' || s || '][20]9801-PMOMC1', s <= 60, 0, case when s <= 60 then now() - interval '5 hours' end
  from generate_series(1, 63) s;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, data_hora)
select 'Massa', 'Almoxarifado', 'PMOMC1', '9801', 'Cliente Massa', 'CX[' || ((i - 1) / 20 + 1)::text || '][20]9801-PMOMC1',
       (800000 + i)::text, (800000 + i)::text, now() - interval '1 hour'
  from generate_series(1, 200) i;

-- PMOMI1: 6 lotes aprovados de 150 peças pela função real do NQA individual; entrada em duas das peças
-- do 1º lote (lote parcialmente lançado).
do $t$
declare b int;
begin
  for b in 0..5 loop
    perform public.teste_lote('PMOMI1', '9802',
      array(select (810000 + b * 150 + g)::text from generate_series(1, 150) g), 'Aprovado');
  end loop;
end $t$;
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, data_hora)
select 'Massa', 'Almoxarifado', 'PMOMI1', '9802', 'Cliente Massa', '', (810000 + g)::text, (810000 + g)::text, now()
  from generate_series(1, 2) g;

-- PMOMA1: 100 peças já entraram no Almoxarifado; as ~1.150 restantes esperam (avulsas).
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, data_hora)
select 'Massa', 'Almoxarifado', 'PMOMA1', '9803', 'Cliente Massa', '', (820000 + g)::text, (820000 + g)::text, now()
  from generate_series(1, 100) g;

-- NADA de analyze aqui: as OPs são novas para o planejador, como a OP de produção do dia.

do $t$ begin
  if (select count(*) from public.sf_registros where pmo = 'PMOMC1') < 10000
     or (select count(*) from public.sf_registros where pmo = 'PMOMI1') < 10000
     or (select count(*) from public.sf_registros where pmo = 'PMOMA1') < 10000 then
    raise exception 'FALHOU: a massa nao tem 10 mil registros por OP'; end if;
  if (select count(*) from public.sf_caixas where pmo = 'PMOMC1' and fechada) < 50 then
    raise exception 'FALHOU: menos de 50 caixas fechadas'; end if;
end $t$;

-- ---------- a função devolve a massa? (sem isso o tempo não prova nada) ----------
do $t$
declare c int; l int; p int; pecas_p int;
begin
  select count(*) into c from public.sf_almox_pendencias_base() where pmo = 'PMOMC1' and tipo = 'caixa';
  select count(*) into l from public.sf_almox_pendencias_base() where pmo = 'PMOMI1' and tipo = 'lote';
  select count(*), coalesce(sum(b.pecas), 0) into p, pecas_p
    from public.sf_almox_pendencias_base() b where b.pmo = 'PMOMA1' and b.tipo = 'peca';
  if c < 40 then raise exception 'FALHOU: so % caixas pendentes em PMOMC1 (esperava ~50)', c; end if;
  if l < 5 then raise exception 'FALHOU: so % lotes pendentes em PMOMI1 (esperava 6)', l; end if;
  if p <> 1 or pecas_p < 1000 then raise exception 'FALHOU: avulsas de PMOMA1: % linhas, % pecas', p, pecas_p; end if;
  raise notice 'a base devolve a massa: % caixas, % lotes, % linha de avulsas (% pecas): ok', c, l, p, pecas_p;
end $t$;

-- ---------- a medição: 1ª execução (fria, sem estatística) com plano, 2ª e 3ª ----------
insert into medidas select 'com massa, 1a execucao (sem analyze)', pg_temp.medir('com massa, 1a execucao', true);
insert into medidas select 'com massa, 2a execucao', pg_temp.medir('com massa, 2a execucao');
insert into medidas select 'com massa, 3a execucao', pg_temp.medir('com massa, 3a execucao');

-- Por OP: cada medição isola uma OP da massa (as demais ficam FINALIZADAS dentro de uma transação que
-- é desfeita), porque o resto da suíte já deixa centenas de caixas/lotes na base e o tempo total não
-- diz quanto custa UMA OP de 10 mil registros.
begin;
update public.sf_ordens set status = 'FINALIZADA' where pmo <> 'PMOMC1';
select pg_temp.medir('so PMOMC1') as ms_c \gset
rollback;
insert into medidas values ('so PMOMC1 (coletiva, 63 caixas)', :ms_c);
begin;
update public.sf_ordens set status = 'FINALIZADA' where pmo <> 'PMOMI1';
select pg_temp.medir('so PMOMI1') as ms_i \gset
rollback;
insert into medidas values ('so PMOMI1 (individual, 6 lotes)', :ms_i);
begin;
update public.sf_ordens set status = 'FINALIZADA' where pmo <> 'PMOMA1';
select pg_temp.medir('so PMOMA1') as ms_a \gset
rollback;
insert into medidas values ('so PMOMA1 (individual, avulsas)', :ms_a);

do $t$
declare v_total numeric; v_pior_op numeric; v_resumo text;
begin
  select max(ms) into v_total from medidas where rotulo like 'com massa%';
  select max(ms) into v_pior_op from medidas where rotulo like 'so PMO%';
  select string_agg(rotulo || ' = ' || round(ms, 1) || ' ms', '; ' order by rotulo) into v_resumo from medidas;
  raise notice 'TEMPO RESUMO: %', v_resumo;
  raise notice 'TEMPO RESUMO: pior OP isolada de 10 mil registros = % ms (criterio 300 ms; falha acima de 900 ms)', v_pior_op;
  if v_pior_op > 900 then
    raise exception 'FALHOU (desempenho): sf_almox_pendencias_base levou % ms numa OP de 10 mil registros (limite 900 ms; criterio 300 ms)', v_pior_op; end if;
end $t$;
