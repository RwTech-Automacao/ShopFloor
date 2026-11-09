-- Testes da 0156: Almoxarifado por necessidade, FASE 2 — o LOTE aprovado no NQA individual vira
-- necessidade (sf_almox_lotes), a pessoa confirma bipando TODOS os SNs do lote (sf_almoxarifado_lote), o bipe avulso
-- é recusado nesse caso (serie_exige_lote) e o cancelamento é do lote inteiro
-- (sf_cancelar_lote_almoxarifado).
-- Roda DEPOIS do almoxarifado_test.sql e do almoxarifado_necessidade_test.sql, na mesma base (reaproveita
-- os stubs, os perfis e os postos 'Embalagem', 'Inspeção NQA' e 'Almoxarifado', e os atalhos
-- teste_reg/teste_caixa/teste_recusa_sem_rastro/teste_aceito). Massa própria em OPs novas (PMOL*).
-- Runner: supabase/tests/rodar-almoxarifado-test.sh
--
-- Os lotes nascem pela sf_nqa_individual REAL (0097, em produção), não por insert à mão: é ela que
-- grava o nqa_lote_id que a 0156 lê. Só os casos que ela não deixa produzir (lote com uma peça só
-- reprovada, lote em OP coletiva) são montados à mão.

-- A 0156 de novo, aqui: a 0133 (aplicada no meio do arquivo antigo) recria a sf_cancelar_lancamento
-- sem a recusa do lote, e é a versão da 0156 que tem que valer daqui pra frente. Reaplicar também
-- prova, de graça, que a migração é idempotente.
\i /tmp/0097.sql
\i /tmp/0156.sql

-- A Tabela NQA: o almoxarifado_test.sql já criou um stub dela (ordem, faixas, amostra) com uma faixa
-- única 1–100 → 2. O Almoxarifado NÃO a consulta mais (decisão de 21/10: confirma-se bipando todos os
-- SNs); ela segue aqui porque a sf_nqa_individual (0097) a usa para aprovar o lote. As faixas daqui
-- entram com `ordem` NEGATIVA pra vir antes, e a amostra passa a aceitar nulo, como na produção (0010).
alter table public.tabela_nqa alter column tamanho_amostra drop not null;
insert into public.tabela_nqa (ordem, quantidade_min, quantidade_max, tamanho_amostra) values
  (-40, 1, 1, 1), (-30, 2, 8, 2), (-20, 9, 15, 3), (-10, 16, null, 5);

select set_config('teste.perms',
  'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual) values
  ('PMOL01', '9201', 'Cliente L', '7000', '7100', true),   -- individual, anterior = Inspeção NQA
  ('PMOL02', '9202', 'Cliente L', '7100', '7200', false),  -- coletiva, anterior = Inspeção NQA
  ('PMOL03', '9203', 'Cliente L', '7200', '7300', true),   -- individual, anterior = Embalagem (sem NQA)
  ('PMOL04', '9204', 'Cliente L', '7300', '7400', true),   -- individual, NQA na rota mas NÃO é o anterior
  ('PMOL05', '9205', 'Cliente L', '7400', '7500', true);   -- individual, anterior = Inspeção NQA (L4)
do $t$ begin
  perform public.teste_op_postos('PMOL01', '9201', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMOL02', '9202', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMOL03', '9203', array['Inspeção NQA', 'Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOL04', '9204', array['Inspeção NQA', 'Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOL05', '9205', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
end $t$;

-- Um lote do NQA individual pela função de produção. Devolve o nqa_lote_id gravado.
create function public.teste_lote(p_pmo text, p_op text, p_sns text[], p_resultado text)
returns uuid language plpgsql as $f$
declare v_amostras jsonb; v_id uuid;
begin
  -- Todas as peças do lote como amostra (aprovada → todas aprovadas; reprovada → a primeira reprovada).
  select jsonb_agg(jsonb_build_object('sn_norm', s,
           'visual', case when lower(p_resultado) = 'reprovado' and s = p_sns[1] then 'Reprovado' else 'Aprovado' end,
           'funcional', 'Aprovado'))
    into v_amostras from unnest(p_sns) s;
  perform sf_nqa_individual(p_pmo, p_op, 'Inspeção NQA', 'Qualidade', p_sns, p_resultado,
    case when lower(p_resultado) = 'reprovado' then 'Embalagem' else '' end, v_amostras);
  select distinct nqa_lote_id into v_id from sf_registros
   where pmo = p_pmo and op = p_op and posto = 'Inspeção NQA' and numero_serie_norm = p_sns[1]
     and nqa_lote_id is not null
   order by nqa_lote_id limit 1;
  -- (só um lote por SN nesta massa, então o limit 1 não escolhe nada)
  return v_id;
end $f$;

-- Nada gravado para o lote: nenhuma linha no Almoxarifado com estes SNs e nenhum envio do lote.
create function public.teste_lote_sem_rastro(p_pmo text, p_lote uuid, p_onde text)
returns void language plpgsql as $f$
begin
  if exists (select 1 from sf_registros a
              where a.pmo = p_pmo and a.posto = 'Almoxarifado'
                and a.numero_serie_norm in (select n.numero_serie_norm from sf_registros n
                                             where n.nqa_lote_id = p_lote)) then
    raise exception 'FALHOU (%): a recusa gravou registro no Almoxarifado', p_onde; end if;
  if exists (select 1 from sf_estoque_envios where lote_id = p_lote) then
    raise exception 'FALHOU (%): a recusa deixou envio na fila', p_onde; end if;
end $f$;

-- =============================================================
-- L1. sf_almox_lotes: lote APROVADO aparece com TODOS os SNs; reprovado e meio-aprovado não aparecem
-- =============================================================
do $t$
declare l1 uuid; l2 uuid; l3 uuid := gen_random_uuid(); v record; n int;
begin
  -- 13 peças embaladas na PMOL01.
  perform teste_reg('PMOL01', '9201', 'Embalagem', s::text, '', s::text) from generate_series(7001, 7013) s;
  l1 := teste_lote('PMOL01', '9201', array['7001','7002','7003','7004','7005'], 'Aprovado');
  l2 := teste_lote('PMOL01', '9201', array['7006','7007','7008'], 'Reprovado');
  -- Lote montado à mão com uma peça aprovada e uma reprovada (a sf_nqa_individual não produz isso,
  -- mas "aprovado = TODAS as linhas aprovadas" tem que valer mesmo assim).
  insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm, nqa_lote_id)
  values ('Q', 'Inspeção NQA', 'PMOL01', '9201', 'Cliente L', 'Aprovado',  '7009', '7009', l3),
         ('Q', 'Inspeção NQA', 'PMOL01', '9201', 'Cliente L', 'Reprovado', '7010', '7010', l3);

  select count(*) into n from sf_almox_lotes('PMOL01', '9201');
  if n <> 1 then raise exception 'FALHOU (L1): esperava só o lote aprovado, veio % lote(s)', n; end if;
  select * into v from sf_almox_lotes('PMOL01', '9201');
  if v.lote_id <> l1 or v.pecas <> 5 or v.amostra <> 5 or v.ja_lancadas <> 0
     or v.sns <> array['7001','7002','7003','7004','7005'] or v.aprovado_em is null then
    raise exception 'FALHOU (L1): lote listado errado: %', row_to_json(v); end if;
  if v.rotulo <> 'LOTE[' || left(replace(l1::text, '-', ''), 8) || '][5]' then
    raise exception 'FALHOU (L1): rótulo do lote: %', v.rotulo; end if;
  raise notice 'L1. sf_almox_lotes: só o aprovado, com todos os SNs, amostra = todas as peças (5): ok';
end $t$;

-- =============================================================
-- L2. Fora do caso, a lista é vazia: OP coletiva, individual sem NQA no anterior, OP inexistente
-- =============================================================
do $t$
declare n int; v_l uuid := gen_random_uuid();
begin
  -- Na coletiva, um "lote" aprovado montado à mão não vira necessidade (a unidade lá é a caixa).
  insert into sf_registros (colaborador, posto, pmo, op, cliente, status, numero_serie, numero_serie_norm, nqa_lote_id)
  values ('Q', 'Inspeção NQA', 'PMOL02', '9202', 'Cliente L', 'Aprovado', '7101', '7101', v_l);
  select count(*) into n from sf_almox_lotes('PMOL02', '9202');
  if n <> 0 then raise exception 'FALHOU (L2): OP coletiva devolveu % lote(s)', n; end if;

  -- Individual com NQA na rota, mas o anterior ao Almoxarifado é a Embalagem: bipe a bipe, sem lote.
  perform teste_reg('PMOL04', '9204', 'Embalagem', s::text, '', s::text) from generate_series(7301, 7302) s;
  perform teste_lote('PMOL04', '9204', array['7301','7302'], 'Aprovado');
  select count(*) into n from sf_almox_lotes('PMOL04', '9204');
  if n <> 0 then raise exception 'FALHOU (L2): individual sem NQA no anterior devolveu % lote(s)', n; end if;

  select count(*) into n from sf_almox_lotes('PMOX99', '0000');
  if n <> 0 then raise exception 'FALHOU (L2): OP inexistente devolveu %', n; end if;
  raise notice 'L2. sf_almox_lotes fora do caso (coletiva, sem NQA no anterior, inexistente): vazio: ok';
end $t$;

-- =============================================================
-- L3. Confirmar com o conjunto ERRADO de SNs recusa SEM GRAVAR NADA
-- =============================================================
do $t$
declare r jsonb; l1 uuid; l2 uuid;
begin
  select lote_id into l1 from sf_almox_lotes('PMOL01', '9201');
  select distinct nqa_lote_id into l2 from sf_registros where numero_serie_norm = '7006' and nqa_lote_id is not null;

  -- Faltando SNs (o lote tem 5): 1 e 4 SNs recusam com lote_incompleto, e o detalhe diz N e F.
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, array['7001']);
  perform teste_recusa_sem_rastro(r, 'lote_incompleto', 'PMOL01', 'L3 faltam 4');
  if r->>'detalhe' is distinct from 'Bipe todas as 5 peças do lote: faltam 4.' then
    raise exception 'FALHOU (L3): detalhe do lote incompleto: %', r; end if;
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, array['7001','7002','7003','7004']);
  perform teste_recusa_sem_rastro(r, 'lote_incompleto', 'PMOL01', 'L3 falta 1');
  if r->>'detalhe' is distinct from 'Bipe todas as 5 peças do lote: faltam 1.' then
    raise exception 'FALHOU (L3): detalhe (falta 1): %', r; end if;
  -- Nenhum SN: também incompleto (vazio e nulo).
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, array[]::text[]);
  perform teste_recusa_sem_rastro(r, 'lote_incompleto', 'PMOL01', 'L3 vazio');
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, null);
  perform teste_recusa_sem_rastro(r, 'lote_incompleto', 'PMOL01', 'L3 nulo');
  -- Repetido conta UMA vez: 5 bipes com só 4 distintos continuam incompletos (falta 1).
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, array['7001','7001','7002','7003','7004']);
  perform teste_recusa_sem_rastro(r, 'lote_incompleto', 'PMOL01', 'L3 SN repetido');
  if r->>'detalhe' is distinct from 'Bipe todas as 5 peças do lote: faltam 1.' then
    raise exception 'FALHOU (L3): repetido conta uma vez: %', r; end if;
  -- SN de fora do lote (7006 é de outro lote) recusa, e diz qual.
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, array['7001','7002','7003','7004','7005','7006']);
  perform teste_recusa_sem_rastro(r, 'amostra_fora_do_lote', 'PMOL01', 'L3 SN de fora');
  if r->>'detalhe' not like '%7006%' then
    raise exception 'FALHOU (L3): o detalhe tem que dizer o SN de fora: %', r; end if;
  -- Lote reprovado e lote inexistente.
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l2, array['7006','7007']);
  perform teste_recusa_sem_rastro(r, 'lote_nao_aprovado', 'PMOL01', 'L3 lote reprovado');
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', gen_random_uuid(), array['7001','7002']);
  perform teste_recusa_sem_rastro(r, 'lote_nao_encontrado', 'PMOL01', 'L3 lote inexistente');
  -- Posto que não é Almoxarifado / OP fora do caso.
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Embalagem', 'Ana', l1, array['7001','7002']);
  perform teste_recusa_sem_rastro(r, 'posto_invalido', 'PMOL01', 'L3 posto inválido');
  r := sf_almoxarifado_lote('PMOL03', '9203', 'Almoxarifado', 'Ana', l1, array['7001','7002']);
  perform teste_recusa_sem_rastro(r, 'lote_nao_se_aplica', 'PMOL03', 'L3 OP sem NQA no anterior');
  r := sf_almoxarifado_lote('PMOL02', '9202', 'Almoxarifado', 'Ana', l1, array['7001','7002']);
  perform teste_recusa_sem_rastro(r, 'lote_nao_se_aplica', 'PMOL02', 'L3 OP coletiva');

  perform teste_lote_sem_rastro('PMOL01', l1, 'L3');
  if exists (select 1 from sf_registros where pmo = 'PMOL01' and posto = 'Almoxarifado')
     or exists (select 1 from sf_estoque_envios where pmo = 'PMOL01') then
    raise exception 'FALHOU (L3): alguma recusa gravou registro ou envio'; end if;
  raise notice 'L3. conjunto errado (faltando, vazio, repetido, de fora), lote reprovado/inexistente, posto e OP fora: recusam sem rastro: ok';
end $t$;

-- =============================================================
-- L4. A Tabela NQA NÃO influencia o Almoxarifado: lote sem faixa/amostra na tabela confirma normalmente
-- =============================================================
do $t$
declare r jsonb; l4 uuid; v record; e public.sf_estoque_envios;
begin
  perform teste_reg('PMOL05', '9205', 'Embalagem', s::text, '', s::text) from generate_series(7401, 7409) s;
  l4 := teste_lote('PMOL05', '9205', array['7401','7402','7403','7404','7405','7406','7407','7408','7409'], 'Aprovado');
  -- Alguém esvaziou a Tabela NQA DEPOIS do NQA aprovar o lote (sem faixa nenhuma para 9 peças).
  create temp table tabela_nqa_bkp as select * from tabela_nqa;
  delete from tabela_nqa;
  select * into v from sf_almox_lotes('PMOL05', '9205') where lote_id = l4;
  if v.amostra is distinct from 9 or v.pecas <> 9 then
    raise exception 'FALHOU (L4): amostra = quantidade a bipar = todas as peças (9): %', row_to_json(v); end if;
  -- Falta uma: recusa; completo: confirma, com UM envio de N=9 e todos os sns.
  r := sf_almoxarifado_lote('PMOL05', '9205', 'Almoxarifado', 'Ana', l4,
         array['7401','7402','7403','7404','7405','7406','7407','7408']);
  perform teste_recusa_sem_rastro(r, 'lote_incompleto', 'PMOL05', 'L4 falta 1');
  perform teste_lote_sem_rastro('PMOL05', l4, 'L4');
  r := sf_almoxarifado_lote('PMOL05', '9205', 'Almoxarifado', 'Ana', l4,
         array['7409','7401','7402','7403','7404','7405','7406','7407','7408']);
  perform teste_aceito(r, 9, 'L4 lote completo sem faixa na Tabela NQA');
  select * into e from sf_estoque_envios where lote_id = l4;
  if e.tipo <> 'lote' or e.quantidade <> 9 or cardinality(e.sns) <> 9 then
    raise exception 'FALHOU (L4): envio do lote: %', to_jsonb(e); end if;
  if (select count(*) from sf_estoque_envios where pmo = 'PMOL05') <> 1 then
    raise exception 'FALHOU (L4): esperava UM envio'; end if;
  insert into tabela_nqa select * from tabela_nqa_bkp;
  drop table tabela_nqa_bkp;
  raise notice 'L4. Tabela NQA vazia: o lote completo confirma, 1 envio com N=9 e todos os sns: ok';
end $t$;

-- =============================================================
-- L5. Confirmar com TODOS os SNs: N registros (com envio_id) e UM envio tipo lote
-- =============================================================
do $t$
declare r jsonb; l1 uuid; e public.sf_estoque_envios; n int; v_rot text;
begin
  select lote_id, rotulo into l1, v_rot from sf_almox_lotes('PMOL01', '9201') where pecas = 5;
  -- Bipe com espaço em volta e um repetido a mais: o repetido não soma, e o conjunto completo confirma.
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1,
         array['7003', ' 7001 ', '7003', '7002', '7004', '7005']);
  perform teste_aceito(r, 5, 'L5 confirmação');
  if r->>'lote' is distinct from v_rot then
    raise exception 'FALHOU (L5): a resposta tinha que trazer o rótulo do lote: %', r; end if;

  select * into e from sf_estoque_envios where lote_id = l1;
  if e.tipo <> 'lote' or e.operacao <> 'entrada' or e.quantidade <> 5 or e.bipe <> v_rot
     or e.serie_norm <> '' or e.alvo <> v_rot
     or e.sns <> array['7001','7002','7003','7004','7005']
     or e.chave <> 'ALMOX/PMOL01/9201/Almoxarifado/' || v_rot || '/E1' then
    raise exception 'FALHOU (L5): envio do lote errado: %', to_jsonb(e); end if;
  select count(*) into n from sf_estoque_envios where pmo = 'PMOL01';
  if n <> 1 then raise exception 'FALHOU (L5): esperava UM envio, veio %', n; end if;

  select count(*) into n from sf_registros
   where pmo = 'PMOL01' and posto = 'Almoxarifado' and envio_id = e.id and numero_caixa = ''
     and colaborador = 'Ana' and cliente = 'Cliente L' and status = '';
  if n <> 5 then raise exception 'FALHOU (L5): esperava 5 registros apontando pro envio, veio %', n; end if;
  if (select array_agg(numero_serie_norm order by numero_serie_norm) from sf_registros
       where pmo = 'PMOL01' and posto = 'Almoxarifado') <> array['7001','7002','7003','7004','7005'] then
    raise exception 'FALHOU (L5): os SNs gravados não são os do lote'; end if;

  -- O lote confirmado sai da lista; reconfirmar recusa por ja_lancado (sem gravar nada).
  if exists (select 1 from sf_almox_lotes('PMOL01', '9201') where lote_id = l1) then
    raise exception 'FALHOU (L5): o lote confirmado tinha que sair da lista'; end if;
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Bruno', l1, array['7002', '7004']);
  perform teste_recusa_sem_rastro(r, 'ja_lancado', 'PMOL01', 'L5 reconfirmação');
  if r->>'detalhe' not like '%Ana%' then
    raise exception 'FALHOU (L5): ja_lancado diz por quem: %', r; end if;
  if (select count(*) from sf_registros where pmo = 'PMOL01' and posto = 'Almoxarifado') <> 5
     or (select count(*) from sf_estoque_envios where pmo = 'PMOL01') <> 1 then
    raise exception 'FALHOU (L5): a reconfirmação gravou alguma coisa'; end if;
  raise notice 'L5. confirmação: 5 registros com envio_id, 1 envio tipo lote com sns completo; confirmado sai da lista e não reconfirma: ok';
end $t$;

-- =============================================================
-- L6. SN do lote já lançado no Almoxarifado: recusa (sem desconto), e o lote aparece com ja_lancadas
-- =============================================================
do $t$
declare r jsonb; l6 uuid; v record;
begin
  l6 := teste_lote('PMOL01', '9201', array['7011','7012','7013'], 'Aprovado');
  -- A peça 7011 entrou por fora (o bipe avulso de antes desta fase, numa OP de teste).
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm)
  values ('Velho', 'Almoxarifado', 'PMOL01', '9201', 'Cliente L', '7011', '7011');
  select * into v from sf_almox_lotes('PMOL01', '9201') where lote_id = l6;
  if v.ja_lancadas is distinct from 1 or v.pecas <> 3 then
    raise exception 'FALHOU (L6): o lote parcial tem que aparecer com ja_lancadas = 1: %', row_to_json(v); end if;
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l6, array['7012','7013']);
  perform teste_recusa_sem_rastro(r, 'lote_com_sn_lancado', 'PMOL01', 'L6 SN já lançado');
  if r->>'detalhe' not like '%7011%' then
    raise exception 'FALHOU (L6): o detalhe tem que dizer o SN já lançado: %', r; end if;
  if exists (select 1 from sf_estoque_envios where lote_id = l6)
     or (select count(*) from sf_registros where pmo = 'PMOL01' and posto = 'Almoxarifado'
          and numero_serie_norm in ('7012','7013')) <> 0 then
    raise exception 'FALHOU (L6): a recusa gravou alguma coisa'; end if;
  delete from sf_registros where colaborador = 'Velho';
  raise notice 'L6. SN do lote já lançado: recusa clara, sem desconto, sem rastro: ok';
end $t$;

-- =============================================================
-- L7. Permissão: sem recebimento.lancar a confirmação recusa; a lista sem permissão é ERRO
-- =============================================================
do $t$
declare r jsonb; l6 uuid; v_erro text; n int;
begin
  select distinct nqa_lote_id into l6 from sf_registros where numero_serie_norm = '7012' and nqa_lote_id is not null;
  perform set_config('teste.perms', 'shopfloor.lancar,shopfloor.visualizar', false);
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l6, array['7012','7013']);
  perform teste_recusa_sem_rastro(r, 'sem_permissao', 'PMOL01', 'L7 sem recebimento.lancar');
  begin
    select count(*) into n from sf_almox_lotes('PMOL01', '9201');
    v_erro := '';
  exception when others then v_erro := SQLERRM;
  end;
  if v_erro is distinct from 'SEM_PERMISSAO' then
    raise exception 'FALHOU (L7): a lista sem recebimento.lancar tinha que dar SEM_PERMISSAO, veio "%"', v_erro; end if;
  perform set_config('teste.perms', 'recebimento.lancar', false);
  begin
    select count(*) into n from sf_almox_lotes('PMOL01', '9201');
    v_erro := '';
  exception when others then v_erro := SQLERRM;
  end;
  if v_erro is distinct from 'SEM_PERMISSAO' then
    raise exception 'FALHOU (L7): a lista sem shopfloor.visualizar tinha que dar SEM_PERMISSAO, veio "%"', v_erro; end if;
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);
  perform teste_lote_sem_rastro('PMOL01', l6, 'L7');
  raise notice 'L7. permissões da confirmação e da lista: ok';
end $t$;

-- =============================================================
-- L8. serie_exige_lote: o bipe avulso na OP individual com NQA no anterior é recusado
-- =============================================================
do $t$
declare r jsonb; c text;
begin
  -- 7012 está num lote aprovado e ainda não entrou: recusa nova, nada gravado.
  r := sf_almoxarifado_entrada('PMOL01', '9201', 'Almoxarifado', 'Ana', '7012', 'serie', 1, '7012');
  perform teste_recusa_sem_rastro(r, 'serie_exige_lote', 'PMOL01', 'L8 peça de lote aprovado');
  if r->>'detalhe' is distinct from 'Esta peça faz parte de um lote do NQA: confirme o lote inteiro.' then
    raise exception 'FALHOU (L8): frase da recusa: %', r; end if;
  if exists (select 1 from sf_registros where pmo = 'PMOL01' and posto = 'Almoxarifado' and numero_serie_norm = '7012') then
    raise exception 'FALHOU (L8): a recusa gravou registro'; end if;
  -- As recusas de antes continuam vindo ANTES: peça de lote reprovado → posto anterior não concluído;
  -- peça já lançada → ja_lancado; peça sem Embalagem → serie_sem_embalagem.
  r := sf_almoxarifado_entrada('PMOL01', '9201', 'Almoxarifado', 'Ana', '7006', 'serie', 1, '7006');
  perform teste_recusa_sem_rastro(r, 'posto_anterior_nao_concluido', 'PMOL01', 'L8 peça reprovada');
  r := sf_almoxarifado_entrada('PMOL01', '9201', 'Almoxarifado', 'Ana', '7001', 'serie', 1, '7001');
  perform teste_recusa_sem_rastro(r, 'ja_lancado', 'PMOL01', 'L8 peça já lançada pelo lote');
  r := sf_almoxarifado_entrada('PMOL01', '9201', 'Almoxarifado', 'Ana', '7099', 'serie', 1, '7099');
  perform teste_recusa_sem_rastro(r, 'serie_sem_embalagem', 'PMOL01', 'L8 peça sem Embalagem');

  -- Individual SEM NQA no anterior: continua bipe a bipe (mesmo com NQA aprovado na rota).
  r := sf_almoxarifado_entrada('PMOL04', '9204', 'Almoxarifado', 'Ana', '7301', 'serie', 1, '7301');
  perform teste_aceito(r, 1, 'L8 individual sem NQA no anterior');
  perform teste_reg('PMOL03', '9203', 'Embalagem', '7201', '', '7201');
  r := sf_almoxarifado_entrada('PMOL03', '9203', 'Almoxarifado', 'Ana', '7201', 'serie', 1, '7201');
  perform teste_aceito(r, 1, 'L8 individual com Embalagem no anterior');
  -- Coletiva com NQA no anterior: continua por caixa.
  c := teste_caixa('PMOL02', '9202', 1, 7150, 2);
  perform teste_reg('PMOL02', '9202', 'Inspeção NQA', s::text, 'Aprovado') from generate_series(7150, 7151) s;
  r := sf_almoxarifado_entrada('PMOL02', '9202', 'Almoxarifado', 'Ana', c, 'caixa', 2, '');
  perform teste_aceito(r, 2, 'L8 coletiva com NQA no anterior');
  raise notice 'L8. serie_exige_lote só na individual com NQA no anterior; coletiva e individual sem NQA intactas: ok';
end $t$;

-- =============================================================
-- L9. Cancelar o LOTE INTEIRO (shopfloor.administrar), envio pendente → cancelado; o lote volta
-- =============================================================
do $t$
declare l1 uuid; v_id uuid; v_avulso uuid; v_erro text; n int; v_envio uuid; e public.sf_estoque_envios;
begin
  select distinct envio_id into v_envio from sf_registros where pmo = 'PMOL01' and posto = 'Almoxarifado' and envio_id is not null;
  select * into e from sf_estoque_envios where id = v_envio;
  l1 := e.lote_id;
  select id into v_id from sf_registros where envio_id = e.id and numero_serie_norm = '7004';
  select id into v_avulso from sf_registros where pmo = 'PMOL04' and posto = 'Almoxarifado' limit 1;

  -- Sem shopfloor.administrar: SEM_PERMISSAO (quem só tem recebimento.lancar não cancela).
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar', false);
  begin perform sf_cancelar_lote_almoxarifado(v_id, 'erro'); v_erro := '';
  exception when others then v_erro := SQLERRM; end;
  if v_erro is distinct from 'SEM_PERMISSAO' then
    raise exception 'FALHOU (L9): sem administrar tinha que dar SEM_PERMISSAO, veio "%"', v_erro; end if;

  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,shopfloor.administrar,lancar', false);
  begin perform sf_cancelar_lote_almoxarifado(v_id, '  '); v_erro := '';
  exception when others then v_erro := SQLERRM; end;
  if v_erro is distinct from 'MOTIVO_OBRIGATORIO' then
    raise exception 'FALHOU (L9): motivo vazio, veio "%"', v_erro; end if;
  -- Linha que não é de lote (entrada avulsa de outra OP).
  begin perform sf_cancelar_lote_almoxarifado(v_avulso, 'erro'); v_erro := '';
  exception when others then v_erro := SQLERRM; end;
  if v_erro is distinct from 'NAO_E_ENTRADA_DE_LOTE' then
    raise exception 'FALHOU (L9): linha avulsa, veio "%"', v_erro; end if;
  -- Cancelar UMA linha do lote pelo cancelamento de lançamento é recusado: o lote é um gesto só.
  begin perform sf_cancelar_lancamento(v_id, 'uma peça'); v_erro := '';
  exception when others then v_erro := SQLERRM; end;
  if v_erro is distinct from 'CANCELE_O_LOTE' then
    raise exception 'FALHOU (L9): cancelar uma linha do lote tinha que dar CANCELE_O_LOTE, veio "%"', v_erro; end if;
  if (select count(*) from sf_registros where envio_id = e.id) <> 5 then
    raise exception 'FALHOU (L9): as recusas apagaram alguma linha'; end if;

  -- O cancelamento de verdade, por QUALQUER linha do lote.
  n := sf_cancelar_lote_almoxarifado(v_id, 'lote errado');
  if n <> 5 then raise exception 'FALHOU (L9): esperava 5 peças canceladas, veio %', n; end if;
  if exists (select 1 from sf_registros where envio_id = e.id) then
    raise exception 'FALHOU (L9): sobraram linhas do lote'; end if;
  if (select count(*) from sf_registros_cancelados where motivo = 'lote errado' and posto = 'Almoxarifado') <> 5 then
    raise exception 'FALHOU (L9): a auditoria tinha que ter as 5 linhas com o motivo'; end if;
  if (select (dados->>'envio_id')::uuid from sf_registros_cancelados where motivo = 'lote errado' limit 1) <> e.id then
    raise exception 'FALHOU (L9): a auditoria guarda o envio_id da linha'; end if;
  select * into e from sf_estoque_envios where id = e.id;
  if e.cancelado_em is null or exists (select 1 from sf_estoque_envios where operacao = 'estorno' and lote_id is not distinct from l1)
     or exists (select 1 from sf_estoque_envios where operacao = 'estorno' and bipe = e.bipe) then
    raise exception 'FALHOU (L9): envio pendente tinha que ser CANCELADO (sem estorno): %', to_jsonb(e); end if;
  -- Cancelar de novo: a linha já não existe.
  begin perform sf_cancelar_lote_almoxarifado(v_id, 'de novo'); v_erro := '';
  exception when others then v_erro := SQLERRM; end;
  if v_erro is distinct from 'NAO_ENCONTRADO' then
    raise exception 'FALHOU (L9): cancelar duas vezes, veio "%"', v_erro; end if;
  -- O lote volta a ser necessidade.
  if not exists (select 1 from sf_almox_lotes('PMOL01', '9201') where lote_id = l1 and ja_lancadas = 0) then
    raise exception 'FALHOU (L9): o lote cancelado tinha que voltar pra lista'; end if;
  raise notice 'L9. cancelar o lote inteiro: permissão, motivo, só linha de lote, linha avulsa do lote recusada; pendente cancelado; lote volta: ok';
end $t$;

-- =============================================================
-- L10. Reconfirmar (E2), o envio sai (ok), e cancelar gera ESTORNO do lote
-- =============================================================
do $t$
declare r jsonb; l1 uuid; e public.sf_estoque_envios; s public.sf_estoque_envios; v_id uuid; n int;
begin
  select lote_id into l1 from sf_almox_lotes('PMOL01', '9201') where pecas = 5;
  r := sf_almoxarifado_lote('PMOL01', '9201', 'Almoxarifado', 'Ana', l1, array['7001','7002','7003','7004','7005']);
  perform teste_aceito(r, 5, 'L10 reconfirmação depois do cancelamento');
  select * into e from sf_estoque_envios where lote_id = l1 and cancelado_em is null and operacao = 'entrada';
  if e.chave not like '%/E2' then raise exception 'FALHOU (L10): reconfirmação tinha que ser E2: %', e.chave; end if;
  -- O worker entregou.
  update sf_estoque_envios set tentativas = 1, reservado_em = now() - interval '1 hour',
         ok = true, enviado_em = now() where id = e.id;
  select id into v_id from sf_registros where envio_id = e.id limit 1;
  n := sf_cancelar_lote_almoxarifado(v_id, 'devolvido');
  if n <> 5 then raise exception 'FALHOU (L10): esperava 5, veio %', n; end if;
  select * into s from sf_estoque_envios where operacao = 'estorno' and entrada_id = e.id;
  if not found or s.quantidade <> 5 or s.tipo <> 'lote' or s.bipe <> e.bipe or s.alvo <> e.alvo then
    raise exception 'FALHOU (L10): esperava estorno de 5 do lote: %', to_jsonb(s); end if;
  if (select estornado from sf_estoque_envios where id = e.id) <> 5 then
    raise exception 'FALHOU (L10): o saldo da entrada tinha que descer a 0'; end if;
  perform public.teste_fila_invariantes('depois do estorno do lote');
  raise notice 'L10. lote já enviado: cancelar gera estorno de N, par gravado, invariantes da fila: ok';
end $t$;

-- =============================================================
-- L11. A fila: CHECK de tipo aceita 'lote' e continua recusando o resto; entrada de lote sem lote_id recusa
-- =============================================================
do $t$
begin
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values ('T/OUTRO', 'PMOL09', '0', 'Almoxarifado', 'outro', 'X', 1);
    raise exception 'FALHOU (L11): aceitou tipo outro';
  exception when check_violation then null; end;
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade)
    values ('T/LOTE', 'PMOL09', '0', 'Almoxarifado', 'lote', 'LOTE[x][1]', 1);
    raise exception 'FALHOU (L11): aceitou entrada de lote sem lote_id/sns';
  exception when check_violation then null; end;
  begin
    insert into sf_estoque_envios (chave, pmo, op, posto, tipo, bipe, quantidade, lote_id)
    values ('T/CX', 'PMOL09', '0', 'Almoxarifado', 'caixa', 'CX[1][1]', 1, gen_random_uuid());
    raise exception 'FALHOU (L11): aceitou lote_id em envio de caixa';
  exception when check_violation then null; end;
  raise notice 'L11. CHECKs da fila (tipo lote, coerência do lote): ok';
end $t$;

-- =============================================================
-- L12. Grants
-- =============================================================
do $t$
begin
  if has_function_privilege('anon', 'public.sf_almox_lotes(text, text)', 'execute')
     or has_function_privilege('anon', 'public.sf_almoxarifado_lote(text, text, text, text, uuid, text[])', 'execute')
     or has_function_privilege('anon', 'public.sf_cancelar_lote_almoxarifado(uuid, text)', 'execute') then
    raise exception 'FALHOU (L12): anon executa função nova'; end if;
  if not has_function_privilege('authenticated', 'public.sf_almox_lotes(text, text)', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_almoxarifado_lote(text, text, text, text, uuid, text[])', 'execute')
     or not has_function_privilege('authenticated', 'public.sf_cancelar_lote_almoxarifado(uuid, text)', 'execute') then
    raise exception 'FALHOU (L12): authenticated não executa função nova'; end if;
  if has_function_privilege('authenticated', 'public.sf_almox_lote_rotulo(uuid, int)', 'execute') then
    raise exception 'FALHOU (L12): a auxiliar do rótulo não pode ser chamada direto'; end if;
  if has_function_privilege('anon', 'public.sf_almoxarifado_entrada(text, text, text, text, text, text, int, text)', 'execute') then
    raise exception 'FALHOU (L12): anon executa a entrada'; end if;
  raise notice 'L12. grants: ok';
end $t$;

do $t$ begin perform public.teste_fila_invariantes('depois dos testes da 0156'); end $t$;
