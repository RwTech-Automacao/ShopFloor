-- Massa N = 1 da foto do NQA (placas_nqa_foto.sql). Entra ANTES da foto_antes e não é alterada por ela:
-- cada cenário da foto roda e é desfeito. Datas no passado (a foto reconhece as linhas novas por
-- data_hora = now()).
-- Runner: supabase/tests/rodar-placas-nqa-test.sh
\set ON_ERROR_STOP on
\o /dev/null

-- Uma linha de sf_registros. `min` = minutos atrás (maior = mais antigo).
create function public.teste_reg(p_pmo text, p_op text, p_posto text, p_sn text, p_caixa text,
                                 p_status text, p_min int, p_retorno text default null)
returns void language sql as $f$
  insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, status,
                                   numero_serie, numero_serie_norm, posto_retorno, data_hora, created_at)
  values ('Massa', p_posto, p_pmo, p_op, 'Cliente ' || p_pmo, p_caixa, p_status, 'SN-' || p_sn, p_sn,
          p_retorno, now() - make_interval(mins => p_min), now() - make_interval(mins => p_min));
$f$;

-- Caixa fechada na Embalagem com as peças p_sns: Teste aprovado + Embalagem carimbada.
create function public.teste_caixa(p_pmo text, p_op text, p_seq int, p_codigo text, p_sns text[])
returns void language plpgsql as $f$
declare s text;
begin
  insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
  values (p_pmo, p_op, 'Embalagem', p_seq, 999, 0, p_codigo, true, 0, now() - interval '5 hours');
  foreach s in array p_sns loop
    perform public.teste_reg(p_pmo, p_op, 'Teste', s, '', 'Aprovado', 600);
    perform public.teste_reg(p_pmo, p_op, 'Embalagem', s, p_codigo, '', 500);
  end loop;
end $f$;

-- ---------- PMOF1/7001: NQA por caixa, N = 1 ----------
insert into public.sf_ordens (pmo, op, placas_por_painel) values ('PMOF1', '7001', 1), ('PMOF2', '7002', 1);

select public.teste_caixa('PMOF1', '7001', 1, 'CX[1][5]7001-PMOF1', array['F101','F102','F103','F104','F105']);
-- F101: defeito no Teste, Manutenção e reteste (linhas repetidas do SN) + rebipe na Embalagem.
select public.teste_reg('PMOF1', '7001', 'Teste', 'F101', '', 'Reprovado', 700);
select public.teste_reg('PMOF1', '7001', 'Manutenção', 'F101', '', '', 650);
select public.teste_reg('PMOF1', '7001', 'Embalagem', 'F101', 'CX[1][5]7001-PMOF1', '', 400);
-- Caixa 2: já inspecionada (último registro das peças é o NQA).
select public.teste_caixa('PMOF1', '7001', 2, 'CX[2][3]7001-PMOF1', array['F201','F202','F203']);
select public.teste_reg('PMOF1', '7001', 'Inspeção NQA', s, '', 'Aprovado', 100)
  from unnest(array['F201','F202','F203']) s;
-- Caixa 3: já deu entrada no Almoxarifado.
select public.teste_caixa('PMOF1', '7001', 3, 'CX[3][2]7001-PMOF1', array['F301','F302']);
select public.teste_reg('PMOF1', '7001', 'Almoxarifado', s, 'CX[3][2]7001-PMOF1', '', 100)
  from unnest(array['F301','F302']) s;

-- ---------- PMOF2/7002: NQA individual, N = 1 ----------
do $t$
declare s text;
begin
  foreach s in array array['G01','G02','G03','G04','G05','G06','G07','G08','G09','G10','G11'] loop
    perform public.teste_reg('PMOF2', '7002', 'Teste', s, '', 'Aprovado', 600);
    perform public.teste_reg('PMOF2', '7002', 'Embalagem', s, s, '', 500);
  end loop;
end $t$;
-- G01: linhas repetidas (defeito + Manutenção + reteste).
select public.teste_reg('PMOF2', '7002', 'Teste', 'G01', '', 'Reprovado', 700);
select public.teste_reg('PMOF2', '7002', 'Manutenção', 'G01', '', '', 650);
-- G08: já no NQA. G09: reprovado no NQA, aguardando o reteste. G10: reprovado e já retestado.
select public.teste_reg('PMOF2', '7002', 'Inspeção NQA', 'G08', '', 'Aprovado', 100);
select public.teste_reg('PMOF2', '7002', 'Inspeção NQA', 'G09', '', 'Reprovado', 100, 'Teste,Inspeção NQA');
select public.teste_reg('PMOF2', '7002', 'Inspeção NQA', 'G10', '', 'Reprovado', 100, 'Teste,Inspeção NQA');
select public.teste_reg('PMOF2', '7002', 'Teste', 'G10', '', 'Aprovado', 50, 'Inspeção NQA');
-- G11: reprovado no NQA com rota Teste → Manutenção → NQA; já passou o Teste, ainda deve a Manutenção.
select public.teste_reg('PMOF2', '7002', 'Inspeção NQA', 'G11', '', 'Reprovado', 100, 'Teste,Manutenção,Inspeção NQA');
select public.teste_reg('PMOF2', '7002', 'Teste', 'G11', '', 'Aprovado', 50, 'Manutenção,Inspeção NQA');
