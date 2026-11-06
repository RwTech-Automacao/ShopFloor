-- Testes da 0175: ESTOQUE DE DESTINO (PA × EINTER) no Almoxarifado.
-- Roda no fim da suíte do almoxarifado com PLACAS=1 (rodar-placas-almoxarifado-test.sh), na mesma base, DEPOIS
-- da 0175 aplicada duas vezes. Reaproveita stubs, postos, perfis e os atalhos teste_reg/teste_lote/teste_op_postos.
-- Cada passo que precisa de instantes diferentes (padrão "último da OP") é um comando de topo: o psql roda
-- cada um na sua transação, então criado_em (now()) difere entre eles.
--
-- Prova: PA sem mudança; EINTER gravado na linha da fila (caixa, peça, lote) na MESMA inserção; valor inválido
-- recusado sem rastro; padrão "último da OP" (ignora cancelada e revertida por inteiro); estorno herda o estoque;
-- linhas antigas viraram PA; sem overload (uma função por nome); privilégios; check da coluna.

\set ON_ERROR_STOP on
\o /dev/null
select set_config('teste.perms',
  'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,shopfloor.administrar,lancar', false);

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $f$;

-- E0. Tudo o que existia na fila antes desta massa é PA (default da coluna), e a fila não tem outro valor ainda.
select pg_temp.confere(
  (select count(*) > 0 and bool_and(estoque = 'PA') from public.sf_estoque_envios),
  'E0 linhas antigas da fila são PA');

-- E0b. Uma função por nome (sem overload): a chamada do app de antes (8/6 argumentos) não é ambígua.
select pg_temp.confere(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sf_almoxarifado_entrada') = 1
  and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'sf_almoxarifado_lote') = 1,
  'E0b uma única assinatura de sf_almoxarifado_entrada e de sf_almoxarifado_lote');

-- E0c. Privilégios: autenticado executa, anônimo não (as três funções).
select pg_temp.confere(
  has_function_privilege('authenticated', 'public.sf_estoque_ultimo_da_op(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.sf_estoque_ultimo_da_op(text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.sf_almoxarifado_entrada(text,text,text,text,text,text,int,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.sf_almoxarifado_entrada(text,text,text,text,text,text,int,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.sf_almoxarifado_lote(text,text,text,text,uuid,text[],text)', 'execute')
  and not has_function_privilege('anon', 'public.sf_almoxarifado_lote(text,text,text,text,uuid,text[],text)', 'execute'),
  'E0c privilégios: authenticated sim, anon não');

-- E0d. O check da coluna.
do $t$ begin
  begin
    update public.sf_estoque_envios set estoque = 'XYZ' where id = (select id from public.sf_estoque_envios limit 1);
    raise exception 'FALHOU: E0d o check de estoque deixou passar XYZ';
  exception when check_violation then null;
  end;
end $t$;

-- Massa: uma OP coletiva (caixas), uma individual com peças avulsas, uma individual com lote do NQA.
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd) values
  ('PMOE01', '9801', 'Cliente E', '',     '',     false, 'EM PRODUCAO', 100),
  ('PMOE02', '9802', 'Cliente E', '9900', '9999', true,  'EM PRODUCAO', 100),
  ('PMOE03', '9803', 'Cliente E', '9500', '9599', true,  'EM PRODUCAO', 100);
do $t$ begin
  perform public.teste_op_postos('PMOE01', '9801', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOE02', '9802', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOE03', '9803', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
end $t$;

-- Caixa fechada de p_n peças carimbadas na Embalagem; devolve o código.
create function public.teste_caixa_est(p_seq int, p_sn0 int, p_n int) returns text language plpgsql as $f$
declare v_cod text := 'CX[' || p_seq || '][' || p_n || ']9801-PMOE01';
begin
  insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
  values ('PMOE01', '9801', 'Embalagem', p_seq, p_n, p_n, v_cod, true, 0, now());
  insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie,
                                   numero_serie_norm, data_hora)
  select 'Massa', 'Embalagem', 'PMOE01', '9801', 'Cliente E', v_cod, (p_sn0 + i)::text, (p_sn0 + i)::text,
         now() - interval '2 hours'
    from generate_series(0, p_n - 1) i;
  return v_cod;
end $f$;
select public.teste_caixa_est(1, 98000, 2);
select public.teste_caixa_est(2, 98100, 2);
select public.teste_caixa_est(3, 98200, 2);
select public.teste_caixa_est(4, 98300, 2);
select public.teste_caixa_est(5, 98400, 2);
select public.teste_caixa_est(6, 98500, 2);

-- E1. Padrão sem nenhuma entrada na OP: PA.
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'PA', 'E1 OP sem entrada: padrão PA');

-- E2. Entrada SEM o 9º argumento (o app de antes) = PA, e a linha da fila diz PA.
select pg_temp.confere(
  sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[1][2]9801-PMOE01', 'caixa', 2, '')
    = '{"ok": true, "quantidade": 2}'::jsonb,
  'E2a entrada sem p_estoque');
select pg_temp.confere(
  (select estoque = 'PA' from sf_estoque_envios where bipe = 'CX[1][2]9801-PMOE01' and operacao = 'entrada'),
  'E2b a fila grava PA quando nada é dito');

-- E3. Entrada EINTER: ok, a MESMA linha da fila já nasce EINTER, e o resultado do banco não muda de forma.
select pg_temp.confere(
  sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[2][2]9801-PMOE01', 'caixa', 2, '', 'EINTER')
    = '{"ok": true, "quantidade": 2}'::jsonb,
  'E3a entrada EINTER');
select pg_temp.confere(
  (select estoque = 'EINTER' and ok = false and cancelado_em is null and tentativas = 0
     from sf_estoque_envios where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'entrada'),
  'E3b a fila nasce com EINTER (e pendente, intocada)');

-- E4. Padrão "último da OP" = EINTER agora.
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'EINTER', 'E4 último da OP: EINTER');
-- ...e outra OP não é afetada.
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE02', '9802') = 'PA', 'E4b outra OP segue PA');

-- E5. Uma PA depois volta o padrão para PA.
select pg_temp.confere(
  (sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[3][2]9801-PMOE01', 'caixa', 2, '', 'PA')->>'ok')::boolean,
  'E5a entrada PA explícita');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'PA', 'E5b último da OP: PA');

-- E6. Chamada NOMEADA com os 8 argumentos antigos (como o PostgREST chama): resolve para a única função.
select pg_temp.confere(
  (sf_almoxarifado_entrada(p_pmo => 'PMOE01', p_op => '9801', p_posto => 'Almoxarifado', p_colaborador => 'Ana',
     p_bipe => 'CX[4][2]9801-PMOE01', p_tipo => 'caixa', p_quantidade => 2, p_serie_norm => '')->>'ok')::boolean,
  'E6 chamada nomeada sem p_estoque');
select pg_temp.confere(
  (select estoque = 'PA' from sf_estoque_envios where bipe = 'CX[4][2]9801-PMOE01' and operacao = 'entrada'),
  'E6b ...e grava PA');

-- E7. Valor inválido: recusa com motivo próprio e SEM rastro (nada em sf_registros, nada na fila).
select pg_temp.confere(
  sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[5][2]9801-PMOE01', 'caixa', 2, '', 'XYZ')->>'motivo'
    = 'estoque_invalido',
  'E7a XYZ é recusado');
select pg_temp.confere(
  not exists (select 1 from sf_estoque_envios where bipe = 'CX[5][2]9801-PMOE01')
  and not exists (select 1 from sf_registros where posto = 'Almoxarifado' and numero_caixa = 'CX[5][2]9801-PMOE01'),
  'E7b a recusa não deixa rastro');
-- Minúsculo também é inválido (a escolha é um enum, não texto livre).
select pg_temp.confere(
  sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[5][2]9801-PMOE01', 'caixa', 2, '', 'einter')->>'motivo'
    = 'estoque_invalido',
  'E7c minúsculo recusado');
-- Nulo vale PA.
do $t$
declare r jsonb;
begin
  r := sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[5][2]9801-PMOE01', 'caixa', 2, '', null);
  perform pg_temp.confere((r->>'ok')::boolean, 'E7d nulo: a entrada foi aceita: ' || r::text);
  perform pg_temp.confere(
    (select estoque = 'PA' from sf_estoque_envios where bipe = 'CX[5][2]9801-PMOE01' and operacao = 'entrada'),
    'E7d nulo vale PA');
end $t$;

-- E8. Sem permissão a leitura do padrão levanta, e a entrada continua recusando como antes.
select set_config('teste.perms', '', false);
do $t$ begin
  begin
    perform sf_estoque_ultimo_da_op('PMOE01', '9801');
    raise exception 'FALHOU: E8 leitura sem permissão passou';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
end $t$;
select pg_temp.confere(
  sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[6][2]9801-PMOE01', 'caixa', 2, '', 'EINTER')->>'motivo'
    = 'sem_permissao',
  'E8b entrada sem permissão continua recusada');
select set_config('teste.perms',
  'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,shopfloor.administrar,lancar', false);

-- E9. Entrada cancelada NÃO conta no padrão. A caixa 6 entra como EINTER e é cancelada (fila limpa):
-- o padrão volta para o da entrada anterior (a caixa 5, PA).
select pg_temp.confere(
  (sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[6][2]9801-PMOE01', 'caixa', 2, '', 'EINTER')->>'ok')::boolean,
  'E9a caixa 6 EINTER');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'EINTER', 'E9b padrão EINTER com a caixa 6 viva');
select pg_temp.confere(
  sf_cancelar_caixa_almoxarifado(
    (select id from sf_registros where pmo = 'PMOE01' and posto = 'Almoxarifado' and numero_caixa = 'CX[6][2]9801-PMOE01'
      order by data_hora desc, id desc limit 1), 'teste E9') = 2,
  'E9c cancelar a caixa 6');
select pg_temp.confere(
  (select cancelado_em is not null from sf_estoque_envios where bipe = 'CX[6][2]9801-PMOE01' and operacao = 'entrada'),
  'E9d a entrada ficou cancelada na fila');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'PA', 'E9e cancelada não conta: padrão volta a PA');

-- E10. O estorno HERDA o estoque da entrada. Caixa 2 (EINTER): marca como tocada (a carga pode ter saído) e
-- cancela → nasce um estorno com estoque EINTER; a caixa 3 (PA) → estorno PA.
update sf_estoque_envios set tentativas = 1 where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'entrada';
update sf_estoque_envios set tentativas = 1 where bipe = 'CX[3][2]9801-PMOE01' and operacao = 'entrada';
select pg_temp.confere(
  sf_cancelar_caixa_almoxarifado(
    (select id from sf_registros where pmo = 'PMOE01' and posto = 'Almoxarifado' and numero_caixa = 'CX[2][2]9801-PMOE01'
      order by data_hora desc, id desc limit 1), 'teste E10a') = 2,
  'E10a cancelar a caixa 2 (tocada)');
select pg_temp.confere(
  (select estoque = 'EINTER' and quantidade = 2 from sf_estoque_envios
    where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'estorno'),
  'E10b o estorno da entrada EINTER é EINTER');
select pg_temp.confere(
  sf_cancelar_caixa_almoxarifado(
    (select id from sf_registros where pmo = 'PMOE01' and posto = 'Almoxarifado' and numero_caixa = 'CX[3][2]9801-PMOE01'
      order by data_hora desc, id desc limit 1), 'teste E10c') = 2,
  'E10c cancelar a caixa 3 (tocada)');
select pg_temp.confere(
  (select estoque = 'PA' from sf_estoque_envios where bipe = 'CX[3][2]9801-PMOE01' and operacao = 'estorno'),
  'E10d o estorno da entrada PA é PA');
-- Mesmo que alguém grave o estorno à mão com outro estoque, vale o da entrada (a regra mora no trigger).
update sf_estoque_envios set estornado = 0 where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'entrada';
insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, entrada_id, estoque)
select 'ALMOX/PMOE01/9801/Almoxarifado/CX[2][2]9801-PMOE01/S9', 'estorno', pmo, op, posto, tipo, bipe, serie_norm, 1, id, 'PA'
  from sf_estoque_envios where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'entrada';
select pg_temp.confere(
  (select estoque = 'EINTER' from sf_estoque_envios where chave = 'ALMOX/PMOE01/9801/Almoxarifado/CX[2][2]9801-PMOE01/S9'),
  'E10e o trigger força o estoque da entrada no estorno');
delete from sf_estoque_envios where chave = 'ALMOX/PMOE01/9801/Almoxarifado/CX[2][2]9801-PMOE01/S9';

-- E11. Entrada revertida por inteiro (estornado = quantidade) também sai do padrão. Estado atual da OP:
-- caixa 1 (PA, viva), 2 (EINTER, revertida por inteiro após o ajuste do E10), 3 (PA, revertida), 4 (PA), 5 (PA).
-- Cria uma EINTER nova (caixa 2 de novo, rebipe) e a reverte por inteiro: o padrão não pode ficar EINTER.
update sf_estoque_envios set estornado = quantidade where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'entrada';
select pg_temp.confere(
  (sf_almoxarifado_entrada('PMOE01', '9801', 'Almoxarifado', 'Ana', 'CX[2][2]9801-PMOE01', 'caixa', 2, '', 'EINTER')->>'ok')::boolean,
  'E11a rebipe da caixa 2 como EINTER (E2 na chave)');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'EINTER', 'E11b padrão EINTER');
update sf_estoque_envios set tentativas = 1 where bipe = 'CX[2][2]9801-PMOE01' and operacao = 'entrada' and cancelado_em is null and chave like '%/E2';
select pg_temp.confere(
  sf_cancelar_caixa_almoxarifado(
    (select id from sf_registros where pmo = 'PMOE01' and posto = 'Almoxarifado' and numero_caixa = 'CX[2][2]9801-PMOE01'
      order by data_hora desc, id desc limit 1), 'teste E11') = 2,
  'E11c reverter a E2 por inteiro');
select pg_temp.confere(
  (select estornado = quantidade from sf_estoque_envios where chave like '%CX[2][2]9801-PMOE01/E2'),
  'E11d a E2 está revertida por inteiro');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE01', '9801') = 'PA', 'E11e revertida por inteiro não conta: PA');

-- E12. Peça avulsa (OP individual sem NQA): EINTER na linha 'serie'.
select teste_reg('PMOE02', '9802', 'Embalagem', s::text, '', s::text, now() - interval '1 hour')
  from generate_series(9901, 9902) s;
select pg_temp.confere(
  (sf_almoxarifado_entrada('PMOE02', '9802', 'Almoxarifado', 'Ana', '9901', 'serie', 1, '9901', 'EINTER')->>'ok')::boolean,
  'E12a peça avulsa EINTER');
select pg_temp.confere(
  (select estoque = 'EINTER' and tipo = 'serie' from sf_estoque_envios where pmo = 'PMOE02' and alvo = '9901' and operacao = 'entrada'),
  'E12b a linha serie é EINTER');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE02', '9802') = 'EINTER', 'E12c padrão da OP 9802: EINTER');

-- E13. Lote do NQA individual.
select teste_reg('PMOE03', '9803', 'Embalagem', s::text, '', s::text, now() - interval '1 hour')
  from generate_series(9501, 9506) s;
select teste_lote('PMOE03', '9803', array['9501','9502','9503'], 'Aprovado');
select teste_lote('PMOE03', '9803', array['9504','9505','9506'], 'Aprovado');
-- inválido: recusa sem rastro
select pg_temp.confere(
  sf_almoxarifado_lote('PMOE03', '9803', 'Almoxarifado', 'Ana',
    (select distinct nqa_lote_id from sf_registros where pmo = 'PMOE03' and numero_serie_norm = '9501' and nqa_lote_id is not null),
    array['9501','9502','9503'], 'XYZ')->>'motivo' = 'estoque_invalido'
  and not exists (select 1 from sf_estoque_envios where pmo = 'PMOE03')
  and not exists (select 1 from sf_registros where pmo = 'PMOE03' and posto = 'Almoxarifado'),
  'E13a lote com estoque inválido: recusado sem rastro');
-- EINTER
select pg_temp.confere(
  (sf_almoxarifado_lote('PMOE03', '9803', 'Almoxarifado', 'Ana',
    (select distinct nqa_lote_id from sf_registros where pmo = 'PMOE03' and numero_serie_norm = '9501' and nqa_lote_id is not null),
    array['9501','9502','9503'], 'EINTER')->>'ok')::boolean,
  'E13b lote EINTER');
select pg_temp.confere(
  (select estoque = 'EINTER' and tipo = 'lote' from sf_estoque_envios where pmo = 'PMOE03' and bipe like '%][3]' order by criado_em limit 1),
  'E13c a linha do lote é EINTER');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE03', '9803') = 'EINTER', 'E13d padrão: EINTER');
-- sem 7º argumento: PA (chamada do app de antes)
select pg_temp.confere(
  (sf_almoxarifado_lote('PMOE03', '9803', 'Almoxarifado', 'Ana',
    (select distinct nqa_lote_id from sf_registros where pmo = 'PMOE03' and numero_serie_norm = '9504' and nqa_lote_id is not null),
    array['9504','9505','9506'])->>'ok')::boolean,
  'E13e lote sem p_estoque aceito');
select pg_temp.confere(
  (select count(*) = 1 from sf_estoque_envios where pmo = 'PMOE03' and estoque = 'PA' and tipo = 'lote'),
  'E13e lote sem p_estoque grava PA');
select pg_temp.confere(sf_estoque_ultimo_da_op('PMOE03', '9803') = 'PA', 'E13f padrão volta a PA');

-- E14. As invariantes da fila (as da suíte) seguem verdadeiras com o estoque novo no meio.
select public.teste_fila_invariantes('ESTOQUE DESTINO: fim do estoque_destino_test.sql');
