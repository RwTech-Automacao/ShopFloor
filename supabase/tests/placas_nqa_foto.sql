-- Foto N = 1 do NQA (sf_nqa_caixa e sf_nqa_individual) sobre a massa placas_nqa_massa.sql.
-- Cada cenário roda a RPC, guarda o retorno (ou a mensagem de erro), as linhas que ela gravou e as
-- chamadas ao espião da sf_aposentar_caixa, e DESFAZ tudo (a massa fica intacta para a próxima foto).
-- O runner tira a foto com as funções antigas (foto_antes: 0097 + 0160) e com a 0166 (foto_depois) e
-- compara linha a linha: com N = 1 tem de ser IDÊNTICO.
-- Uso: psql -v tabela=foto_antes -f placas_nqa_foto.sql
\set ON_ERROR_STOP on
\o /dev/null

create table :tabela (cenario text primary key, retorno jsonb, linhas jsonb, aposentadas jsonb, erro text);

create function pg_temp.cenario(p_tabela text, p_nome text, p_perms text, p_sql text)
returns void language plpgsql as $f$
declare
  v_ret jsonb; v_linhas jsonb; v_apos jsonb; v_erro text;
begin
  begin
    perform set_config('teste.perms', p_perms, true);
    execute p_sql into v_ret;
    -- Linhas novas = as desta transação (a massa tem data_hora no passado).
    select jsonb_agg(jsonb_build_object(
             'posto', posto, 'status', status, 'sn', numero_serie, 'sn_norm', numero_serie_norm,
             'cliente', cliente, 'colaborador', colaborador, 'visual', nqa_visual,
             'funcional', nqa_funcional, 'obs', observacao, 'retorno', posto_retorno,
             'caixa', numero_caixa, 'pecas', pecas, 'tem_lote', nqa_lote_id is not null)
           order by numero_serie_norm, posto)
      into v_linhas
      from public.sf_registros where data_hora = now();
    select jsonb_agg(to_jsonb(a) order by a.numero_caixa) into v_apos from public.teste_aposentadas a;
    raise exception '__desfaz__';
  exception when others then
    if sqlerrm <> '__desfaz__' then v_erro := sqlerrm; end if;
  end;
  execute format('insert into %I values ($1, $2, $3, $4, $5)', p_tabela)
    using p_nome, v_ret, v_linhas, v_apos, v_erro;
end $f$;

-- ---------- caixa ----------
select pg_temp.cenario(:'tabela', 'k01 aprova 2 amostras', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F101","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F102","visual":"Aprovado","funcional":"Aprovado","observacao":"ok"}]') $q$);
select pg_temp.cenario(:'tabela', 'k02 amostras insuficientes', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F101","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k03 amostra fora da caixa', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F201","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F102","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k04 aprovado com reprova', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F101","visual":"Reprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F102","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k05 reprovado sem reprova', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Reprovado','Embalagem,Inspeção NQA',
    '[{"sn_norm":"F101","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k06 reprova volta pela Embalagem (aposenta)', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Reprovado','Embalagem,Inspeção NQA',
    '[{"sn_norm":"F103","visual":"Aprovado","funcional":"Reprovado","observacao":"curto"}]') $q$);
select pg_temp.cenario(:'tabela', 'k07 reprova volta pelo Teste (não aposenta)', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Reprovado','Teste,Inspeção NQA',
    '[{"sn_norm":"F103","visual":"Reprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k08 caixa já inspecionada', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[2][3]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F201","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F202","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k09 caixa no almoxarifado', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[3][2]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F301","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F302","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k10 caixa vazia', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[9][1]7001-PMOF1','Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'k11 amostra repetida conta duas vezes', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','',
    '[{"sn_norm":"F101","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F101","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k12 sem permissão', 'shopfloor.lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'k13 amostra sem sn_norm', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','',
    '[{"visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"F104","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'k14 amostras nulas', 'lancar', $q$
  select sf_nqa_caixa('PMOF1','7001','Inspeção NQA','Q','CX[1][5]7001-PMOF1','Aprovado','', null) $q$);

-- ---------- individual ----------
select pg_temp.cenario(:'tabela', 'i01 aprova lote de 5', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02','G03','G04','G05'],'Aprovado','',
    '[{"sn_norm":"G01","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"G02","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i02 amostras insuficientes', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02','G03','G04','G05'],'Aprovado','',
    '[{"sn_norm":"G01","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i03 SN duplicado', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02','G01'],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i04 SN fora da OP', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','X99'],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i05 lote já inspecionado', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G07','G08'],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i06 reteste incompleto', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G07','G11'],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i06b peça aguardando reteste', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G07','G09'],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i07 amostra fora do lote', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02'],'Aprovado','',
    '[{"sn_norm":"G06","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i08 reprova o lote', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G03','G04','G05'],'Reprovado','Teste,Inspeção NQA',
    '[{"sn_norm":"G04","visual":"Reprovado","funcional":"Aprovado","observacao":"risco"}]') $q$);
select pg_temp.cenario(:'tabela', 'i09 lote com peça retestada', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G06','G07','G10'],'Aprovado','',
    '[{"sn_norm":"G06","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"G10","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i10 lote vazio', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array[]::text[],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i11 aprovado com reprova', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02'],'Aprovado','',
    '[{"sn_norm":"G01","visual":"Aprovado","funcional":"Reprovado","observacao":""},
      {"sn_norm":"G02","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i12 reprovado sem reprova', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02'],'Reprovado','Teste,Inspeção NQA',
    '[{"sn_norm":"G01","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i13 amostra repetida conta duas vezes', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01','G02','G03'],'Aprovado','',
    '[{"sn_norm":"G01","visual":"Aprovado","funcional":"Aprovado","observacao":""},
      {"sn_norm":"G01","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);
select pg_temp.cenario(:'tabela', 'i14 sem permissão', 'shopfloor.lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G01'],'Aprovado','','[]') $q$);
select pg_temp.cenario(:'tabela', 'i15 lote de 1 (faixa fora da tabela)', 'lancar', $q$
  select sf_nqa_individual('PMOF2','7002','Inspeção NQA','Q',array['G02'],'Aprovado','',
    '[{"sn_norm":"G02","visual":"Aprovado","funcional":"Aprovado","observacao":""}]') $q$);

\o
select :'tabela' as foto, count(*) as cenarios,
       count(*) filter (where erro is null) as gravaram from :tabela;
