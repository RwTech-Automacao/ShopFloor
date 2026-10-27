-- Testes da 0166: NQA de caixa e NQA individual com o `total` em PLACAS (placas por painel).
-- Decisão do usuário (opção C): a amostra e a aprovação seguem em PAINÉIS, como antes; só o `total`
-- devolvido é em placas.
-- Roda depois da massa N = 1 da foto (usa os mesmos atalhos teste_reg/teste_caixa), em OPs próprias
-- com placas_por_painel = 50 (1 SN = 1 painel = 50 placas).
-- Runner: supabase/tests/rodar-placas-nqa-test.sh
--
-- Tabela NQA do esquema: 2–8 → 2, 9–15 → 3 (em placas seria 281–500 → 50: impossível com 10 painéis).
--   C1 caixa de 10 painéis (com rebipe e defeito repetindo SN): amostra pela faixa de 10 (3); 1 painel
--      amostrado NÃO vale 50 (insuficiente); amostra repetida conta 1 por entrada; com 3 amostras
--      aprova e o total é 500; 10 linhas do NQA, cada uma com pecas 50.
--   C2 caixa de 11 painéis: amostra 3, total 550.
--   C3 reteste da caixa: reprova (500), retesta, reinspeciona → 500 de novo (não infla).
--   I1 lote de 4 painéis: amostra pela faixa de 4 (2): 1 é insuficiente, 2 aprovam com total 200.
--   I2 lote de 11 painéis: amostra 3, total 550.
--   I3 reteste do lote: reprova (200), retesta, lote novo → 200.
--   I4 duplicidade e "SN da OP" seguem por SN; sem 'lancar' → SEM_PERMISSAO (gate de 1 argumento).
\set ON_ERROR_STOP on
\o /dev/null
select set_config('teste.perms', 'lancar', false);

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $f$;

-- Amostras aprovadas dos SNs informados.
create function pg_temp.amostras(p_sns text[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('sn_norm', s, 'visual', 'Aprovado', 'funcional', 'Aprovado',
                                               'observacao', '')), '[]'::jsonb)
    from unnest(p_sns) s
$f$;

-- Erro de uma chamada (texto), ou 'ok' se passou.
create function pg_temp.erro_de(p_sql text) returns text language plpgsql as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end $f$;

insert into public.sf_ordens (pmo, op, placas_por_painel) values
  ('PMOP1', '7101', 50),   -- caixa
  ('PMOP2', '7102', 50);   -- individual

-- =============================================================
-- Caixas (N = 50)
-- =============================================================
select public.teste_caixa('PMOP1', '7101', 1, 'CX[1][500]7101-PMOP1',
  array['P001','P002','P003','P004','P005','P006','P007','P008','P009','P010']);
-- P001: defeito no Teste + Manutenção + rebipe na mesma caixa. Não pode virar 550 nem 600.
select public.teste_reg('PMOP1', '7101', 'Teste', 'P001', '', 'Reprovado', 700);
select public.teste_reg('PMOP1', '7101', 'Manutenção', 'P001', '', '', 650);
select public.teste_reg('PMOP1', '7101', 'Embalagem', 'P001', 'CX[1][500]7101-PMOP1', '', 400);
select public.teste_caixa('PMOP1', '7101', 2, 'CX[2][550]7101-PMOP1',
  array['P101','P102','P103','P104','P105','P106','P107','P108','P109','P110','P111']);
select public.teste_caixa('PMOP1', '7101', 3, 'CX[3][500]7101-PMOP1',
  array['P201','P202','P203','P204','P205','P206','P207','P208','P209','P210']);

select pg_temp.confere(
  (select count(*) from sf_registros where pmo = 'PMOP1' and pecas <> 50) = 0,
  'massa: toda linha da OP N = 50 nasce com pecas = 50 (trigger da 0161)');

-- C1: amostra pela faixa de 10 PAINÉIS (3). Um painel amostrado conta 1, não 50.
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[1][500]7101-PMOP1',
                    'Aprovado', '', pg_temp.amostras(array['P003'])) $q$) = 'AMOSTRAS_INSUFICIENTES',
  'C1-0 1 painel amostrado não vale 50: a amostra é 3 painéis');
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[1][500]7101-PMOP1',
                    'Aprovado', '', pg_temp.amostras(array['P003','P004'])) $q$) = 'AMOSTRAS_INSUFICIENTES',
  'C1-1 2 painéis (100 placas) ainda não são os 3 da faixa de 10');
do $t$
declare r jsonb;
begin
  -- Amostra repetida (P003 duas vezes) conta 1 por entrada, como antes: 3 entradas = 3.
  r := sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[1][500]7101-PMOP1', 'Aprovado', '',
                    pg_temp.amostras(array['P003','P003','P004']));
  perform pg_temp.confere((r->>'ok')::boolean and (r->>'total')::int = 500,
    'C1a caixa de 10 painéis × 50: total 500, veio ' || r::text);
end $t$;
select pg_temp.confere(
  (select count(*) from sf_registros where pmo = 'PMOP1' and posto = 'Inspeção NQA') = 10,
  'C1b uma linha do NQA por SN (10), vieram '
    || (select count(*) from sf_registros where pmo = 'PMOP1' and posto = 'Inspeção NQA'));
select pg_temp.confere(
  (select sum(pecas) from sf_registros where pmo = 'PMOP1' and posto = 'Inspeção NQA') = 500,
  'C1c as linhas do NQA somam 500 placas');
select pg_temp.confere(
  (select observacao from sf_registros where pmo = 'PMOP1' and posto = 'Inspeção NQA'
      and numero_serie_norm = 'P005') = 'Por amostragem',
  'C1d painel não amostrado grava "Por amostragem"');

-- C2: caixa de 11 painéis → amostra 3 (faixa 9–15), total 550.
do $t$
declare r jsonb;
begin
  r := sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[2][550]7101-PMOP1', 'Aprovado', '',
                    pg_temp.amostras(array['P101','P102','P103']));
  perform pg_temp.confere((r->>'ok')::boolean and (r->>'total')::int = 550,
    'C2 3 painéis amostrados, total 550, veio ' || r::text);
end $t$;

-- C3: reteste da caixa não infla o total.
do $t$
declare r jsonb; s text;
begin
  r := sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[3][500]7101-PMOP1', 'Reprovado',
                    'Teste,Inspeção NQA',
                    '[{"sn_norm":"P201","visual":"Reprovado","funcional":"Aprovado","observacao":"x"}]');
  perform pg_temp.confere((r->>'total')::int = 500, 'C3a reprova da caixa: total 500, veio ' || r::text);
  -- Reteste: cada painel repassa o Teste (consome a rota), linha mais nova que a do NQA.
  foreach s in array array['P201','P202','P203','P204','P205','P206','P207','P208','P209','P210'] loop
    insert into sf_registros (colaborador, posto, pmo, op, status, numero_serie, numero_serie_norm,
                              posto_retorno, data_hora, created_at)
    values ('Massa', 'Teste', 'PMOP1', '7101', 'Aprovado', 'SN-' || s, s, 'Inspeção NQA',
            now() + interval '1 minute', now() + interval '1 minute');
  end loop;
end $t$;
do $t$
declare r jsonb;
begin
  r := sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[3][500]7101-PMOP1', 'Aprovado', '',
                    pg_temp.amostras(array['P202','P203','P204']));
  perform pg_temp.confere((r->>'ok')::boolean and (r->>'total')::int = 500,
    'C3b reinspeção depois do reteste: total 500 (não 1000), veio ' || r::text);
end $t$;
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[1][500]7101-PMOP1',
                    'Aprovado', '', pg_temp.amostras(array['P003','P004','P005'])) $q$) = 'CAIXA_JA_INSPECIONADA',
  'C3c "no NQA agora" segue por SN');

-- =============================================================
-- Lotes do NQA individual (N = 50)
-- =============================================================
do $t$
declare s text;
begin
  foreach s in array array['Q01','Q02','Q03','Q04','Q05','Q06','Q07','Q08',
                           'R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11'] loop
    perform public.teste_reg('PMOP2', '7102', 'Teste', s, '', 'Aprovado', 600);
    perform public.teste_reg('PMOP2', '7102', 'Embalagem', s, s, '', 500);
  end loop;
end $t$;
-- Q01: defeito + Manutenção + rebipe na Embalagem (linhas repetidas do SN).
select public.teste_reg('PMOP2', '7102', 'Teste', 'Q01', '', 'Reprovado', 700);
select public.teste_reg('PMOP2', '7102', 'Manutenção', 'Q01', '', '', 650);
select public.teste_reg('PMOP2', '7102', 'Embalagem', 'Q01', 'Q01', '', 400);

-- I1: lote de 4 painéis → amostra pela faixa de 4 (2): 1 painel não vale 50.
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                    array['Q01','Q02','Q03','Q04'], 'Aprovado', '',
                    pg_temp.amostras(array['Q02'])) $q$) = 'AMOSTRAS_INSUFICIENTES',
  'I1-0 1 painel amostrado não vale 50: a amostra é 2 painéis');
do $t$
declare r jsonb;
begin
  r := sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q', array['Q01','Q02','Q03','Q04'], 'Aprovado', '',
                         pg_temp.amostras(array['Q02','Q03']));
  perform pg_temp.confere((r->>'ok')::boolean and (r->>'total')::int = 200,
    'I1a lote de 4 painéis × 50: total 200, veio ' || r::text);
end $t$;
select pg_temp.confere(
  (select count(*) from sf_registros where pmo = 'PMOP2' and posto = 'Inspeção NQA') = 4,
  'I1b uma linha do NQA por SN (4)');

-- I2: 11 painéis → amostra 3 (faixa 9–15): 2 é pouco, 3 aprovam com total 550.
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                    array['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11'], 'Aprovado', '',
                    pg_temp.amostras(array['R01','R02'])) $q$) = 'AMOSTRAS_INSUFICIENTES',
  'I2a 11 painéis exigem 3 amostras: 2 (100 placas) é insuficiente');
do $t$
declare r jsonb;
begin
  r := sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                         array['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11'], 'Aprovado', '',
                         pg_temp.amostras(array['R01','R02','R03']));
  perform pg_temp.confere((r->>'ok')::boolean and (r->>'total')::int = 550,
    'I2b 3 painéis passam e o total é 550, veio ' || r::text);
end $t$;

-- I3: reteste do lote não infla.
do $t$
declare r jsonb; s text;
begin
  r := sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q', array['Q05','Q06','Q07','Q08'], 'Reprovado',
                         'Teste,Inspeção NQA',
                         '[{"sn_norm":"Q05","visual":"Reprovado","funcional":"Aprovado","observacao":"x"}]');
  perform pg_temp.confere((r->>'total')::int = 200, 'I3a reprova do lote: total 200, veio ' || r::text);
  foreach s in array array['Q05','Q06','Q07','Q08'] loop
    insert into sf_registros (colaborador, posto, pmo, op, status, numero_serie, numero_serie_norm,
                              posto_retorno, data_hora, created_at)
    values ('Massa', 'Teste', 'PMOP2', '7102', 'Aprovado', 'SN-' || s, s, 'Inspeção NQA',
            now() + interval '1 minute', now() + interval '1 minute');
  end loop;
end $t$;
do $t$
declare r jsonb;
begin
  r := sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q', array['Q05','Q06','Q07','Q08'], 'Aprovado', '',
                         pg_temp.amostras(array['Q06','Q07']));
  perform pg_temp.confere((r->>'ok')::boolean and (r->>'total')::int = 200,
    'I3b lote novo depois do reteste: total 200 (não 400), veio ' || r::text);
end $t$;

-- I4: duplicidade, SN da OP e "no NQA agora" por SN; gate de 1 argumento.
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                    array['Q01','Q01'], 'Aprovado', '', '[]') $q$) = 'LOTE_SN_DUPLICADO',
  'I4a SN repetido no lote segue LOTE_SN_DUPLICADO');
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                    array['R01','ZZ9'], 'Aprovado', '', '[]') $q$) = 'SN_FORA_DA_OP',
  'I4b SN fora da OP segue SN_FORA_DA_OP');
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                    array['Q01'], 'Aprovado', '', pg_temp.amostras(array['Q01'])) $q$) = 'LOTE_JA_INSPECIONADO',
  'I4c peça já no NQA segue LOTE_JA_INSPECIONADO');
select set_config('teste.perms', 'shopfloor.lancar', false);
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_individual('PMOP2', '7102', 'Inspeção NQA', 'Q',
                    array['R01'], 'Aprovado', '', '[]') $q$) = 'SEM_PERMISSAO',
  'I4d sf_nqa_individual exige tem_permissao(''lancar'') (1 argumento)');
select pg_temp.confere(
  pg_temp.erro_de($q$ select sf_nqa_caixa('PMOP1', '7101', 'Inspeção NQA', 'Q', 'CX[2][550]7101-PMOP1',
                    'Aprovado', '', '[]') $q$) = 'SEM_PERMISSAO',
  'I4e sf_nqa_caixa exige tem_permissao(''lancar'') (1 argumento)');
select set_config('teste.perms', 'lancar', false);

\o
select 'PLACAS NQA: C1–C3 e I1–I4 ok' as resultado;
