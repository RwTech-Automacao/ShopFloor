-- Testes da 0165: Almoxarifado e fila do Compels em PLACAS (placas por painel).
-- Roda DEPOIS dos 5 arquivos do almoxarifado (almoxarifado_test, _necessidade, _lote, _pendencias,
-- _pecas_avulsas), na mesma base: reaproveita stubs, perfis, postos ('Embalagem', 'Inspeção Saída',
-- 'Inspeção NQA', 'Almoxarifado'), o stub do auth.uid() e os atalhos teste_reg/teste_lote/teste_op_postos.
-- Massa própria em OPs novas (PMOZ*), com placas_por_painel = 50 (e uma de controle com N = 1).
-- Runner: supabase/tests/rodar-placas-almoxarifado-test.sh (PLACAS=1 no rodar-almoxarifado-test.sh).
--
-- O que prova (N = 50, 1 SN = 1 painel = 50 placas):
--   Z1  caixa coletiva de 10 painéis: necessidade/pendência/detalhe = 500; entrada grava 500 na fila;
--       rebipe diz "500 de 500"; cancelar UMA linha ajusta a fila em 50; cancelar a caixa inteira devolve
--       o que sobrou (450); caixa TOCADA cancelada devolve 500 e estorna 500; etiqueta CX[n][500] com 10
--       painéis NÃO é divergência (com 9 é: 450 entraram, etiqueta 500); posto anterior "300 de 500".
--   Z2  peça avulsa: pendência/detalhe em placas (e `paineis` = SNs); entrada grava 50; cancelar reverte 50.
--   Z3  lote do NQA de 4 painéis: lista/pendência/detalhe com pecas 200 e amostra 4; ainda exige os 4 SNs;
--       envio 200; cancelar lote devolve 200 e estorna 200; SN lançado por fora conta 50 placas.
--   Z5  controle N = 1: os mesmos números de antes (caixa de 3 → 3; cancelar 1 → fila 2).
-- A identidade N = 1 de verdade vem de rodar a suíte inteira do almoxarifado com a 0165 aplicada e da
-- foto das leituras (rodar-almoxarifado-test.sh com PLACAS=1).

\set ON_ERROR_STOP on
select set_config('teste.perms',
  'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,shopfloor.administrar,lancar', false);

create function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $f$
begin
  if cond is not true then raise exception 'FALHOU: %', msg; end if;
end $f$;

-- Caixa fechada com p_paineis SNs carimbados na Embalagem e o código com p_qtd_codigo (em placas,
-- como a sf_fechar_caixa da 0163 imprime).
create function public.teste_caixa_placas(p_pmo text, p_op text, p_seq int, p_sn0 int, p_paineis int,
                                          p_qtd_codigo int)
returns text language plpgsql as $f$
declare v_cod text := 'CX[' || p_seq || '][' || p_qtd_codigo || ']' || p_op || '-' || p_pmo;
begin
  insert into public.sf_caixas (pmo, op, posto, seq, limite, qtd, codigo, fechada, revisao, fechada_em)
  values (p_pmo, p_op, 'Embalagem', p_seq, p_qtd_codigo, p_qtd_codigo, v_cod, true, 0, now());
  insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie,
                                   numero_serie_norm, data_hora)
  select 'Massa', 'Embalagem', p_pmo, p_op, 'Cliente Z', v_cod, (p_sn0 + i)::text, (p_sn0 + i)::text,
         now() - interval '2 hours'
    from generate_series(0, p_paineis - 1) i;
  return v_cod;
end $f$;

-- A linha mais recente do Almoxarifado de um SN (é o "último bipe" que o LIFO aceita cancelar).
create function public.teste_almox_id(p_pmo text, p_sn text) returns uuid language sql as $f$
  select id from public.sf_registros
   where pmo = p_pmo and posto = 'Almoxarifado' and numero_serie_norm = p_sn
   order by data_hora desc, id desc limit 1
$f$;

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd,
                              placas_por_painel) values
  ('PMOZ01', '9601', 'Cliente Z', '',     '',     false, 'EM PRODUCAO', 2000, 50),  -- coletiva, anterior Embalagem
  ('PMOZ02', '9602', 'Cliente Z', '',     '',     false, 'EM PRODUCAO', 2000, 50),  -- coletiva, anterior Inspeção Saída
  ('PMOZ03', '9603', 'Cliente Z', '9700', '9800', true,  'EM PRODUCAO', 2000, 50),  -- individual, peças avulsas
  ('PMOZ04', '9604', 'Cliente Z', '9800', '9900', true,  'EM PRODUCAO', 2000, 50),  -- individual, lote do NQA
  ('PMOZ05', '9605', 'Cliente Z', '',     '',     false, 'EM PRODUCAO', 20,   1);   -- controle N = 1
do $t$ begin
  perform public.teste_op_postos('PMOZ01', '9601', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOZ02', '9602', array['Embalagem', 'Inspeção Saída', 'Almoxarifado']);
  perform public.teste_op_postos('PMOZ03', '9603', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOZ04', '9604', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMOZ05', '9605', array['Embalagem', 'Almoxarifado']);
end $t$;

-- =============================================================
-- Z1. Caixa coletiva de 10 painéis (N = 50)
-- =============================================================
select public.teste_caixa_placas('PMOZ01', '9601', 1, 96000, 10, 500);
-- Uma 2ª linha do MESMO SN na mesma caixa (rebipe/defeito na Embalagem): não pode virar 550.
insert into public.sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm)
values ('Massa', 'Embalagem', 'PMOZ01', '9601', 'Cliente Z', 'CX[1][500]9601-PMOZ01', '96000', '96000');

select pg_temp.confere(
  (select pecas from sf_almox_necessidades('PMOZ01', '9601') where codigo = 'CX[1][500]9601-PMOZ01') = 500,
  'Z1a necessidade da caixa em placas (500): '
    || coalesce((select pecas::text from sf_almox_necessidades('PMOZ01', '9601')), 'nada'));
select pg_temp.confere(
  (select pecas from sf_almox_pendencias() p where p.pmo = 'PMOZ01' and p.codigo = 'CX[1][500]9601-PMOZ01') = 500,
  'Z1b pendência da caixa em placas (500)');
select pg_temp.confere(
  (select (d->>'pecas')::int = 500 and jsonb_array_length(d->'sns') = 10 and (d->>'recebidas_op')::int = 0
     from sf_almox_detalhe('PMOZ01', '9601', 'CX[1][500]9601-PMOZ01', null) d),
  'Z1c detalhe da caixa: pecas 500, 10 SNs, recebidas 0: '
    || sf_almox_detalhe('PMOZ01', '9601', 'CX[1][500]9601-PMOZ01', null)::text);

do $t$
declare r jsonb; e record;
begin
  r := sf_almoxarifado_entrada('PMOZ01', '9601', 'Almoxarifado', 'Ana', 'CX[1][500]9601-PMOZ01', 'caixa', 500, '');
  perform pg_temp.confere(r = '{"ok": true, "quantidade": 500}'::jsonb,
    'Z1d entrada da caixa: quantidade 500 e sem divergência de etiqueta: ' || r::text);
  select * into e from sf_estoque_envios where bipe = 'CX[1][500]9601-PMOZ01' and operacao = 'entrada';
  perform pg_temp.confere(e.quantidade = 500 and e.tipo = 'caixa',
    'Z1d fila: quantidade 500 (veio ' || e.quantidade || ')');
  perform pg_temp.confere(
    (select count(*) = 10 and sum(pecas) = 500 from sf_registros
      where pmo = 'PMOZ01' and posto = 'Almoxarifado' and numero_caixa = 'CX[1][500]9601-PMOZ01'),
    'Z1d registros: 10 linhas (uma por painel) de 50 placas');
  perform pg_temp.confere(
    (sf_almox_detalhe('PMOZ01', '9601', 'CX[1][500]9601-PMOZ01', null)->>'recebidas_op')::int = 500,
    'Z1d recebidas_op da OP em placas (500)');
  perform pg_temp.confere(not exists (select 1 from sf_almox_necessidades('PMOZ01', '9601')),
    'Z1d a caixa sai da lista de necessidades');

  r := sf_almoxarifado_entrada('PMOZ01', '9601', 'Almoxarifado', 'Bia', 'CX[1][500]9601-PMOZ01', 'caixa', 500, '');
  perform pg_temp.confere(r->>'motivo' = 'ja_lancado'
      and r->>'detalhe' like '%500 de 500 peças desta caixa estão lançadas.',
    'Z1e rebipe: "500 de 500": ' || r::text);

  -- Cancelar UMA linha (LIFO peça a peça): a fila limpa é AJUSTADA em 50, não em 1.
  perform sf_cancelar_lancamento(teste_almox_id('PMOZ01', '96009'), 'teste Z1f');
  select * into e from sf_estoque_envios where bipe = 'CX[1][500]9601-PMOZ01' and operacao = 'entrada';
  perform pg_temp.confere(e.quantidade = 450 and e.cancelado_em is null,
    'Z1f cancelar uma linha ajusta a fila pra 450 (veio ' || e.quantidade || ')');
  r := sf_almoxarifado_entrada('PMOZ01', '9601', 'Almoxarifado', 'Bia', 'CX[1][500]9601-PMOZ01', 'caixa', 500, '');
  perform pg_temp.confere(r->>'detalhe' like '%450 de 500 peças desta caixa estão lançadas. Um cancelamento anterior parou no meio%',
    'Z1f rebipe parcial: "450 de 500": ' || r::text);

  -- Cancelar a caixa inteira (o que sobrou: 9 painéis): devolve 450 placas e cancela a fila limpa.
  perform pg_temp.confere(
    sf_cancelar_caixa_almoxarifado(teste_almox_id('PMOZ01', '96000'), 'teste Z1g') = 450,
    'Z1g cancelar a caixa inteira devolve 450');
  select * into e from sf_estoque_envios where bipe = 'CX[1][500]9601-PMOZ01' and operacao = 'entrada';
  perform pg_temp.confere(e.cancelado_em is not null, 'Z1g a entrada limpa é cancelada');
end $t$;

-- Z1h. Caixa TOCADA (a carga já saiu): cancelar a caixa devolve 500 e ESTORNA 500.
select public.teste_caixa_placas('PMOZ01', '9601', 2, 96100, 10, 500);
do $t$
declare r jsonb; e record; n int;
begin
  r := sf_almoxarifado_entrada('PMOZ01', '9601', 'Almoxarifado', 'Ana', 'CX[2][500]9601-PMOZ01', 'caixa', 500, '');
  perform pg_temp.confere((r->>'quantidade')::int = 500, 'Z1h entrada da caixa 2: ' || r::text);
  update sf_estoque_envios set tentativas = 1
   where bipe = 'CX[2][500]9601-PMOZ01' and operacao = 'entrada';
  n := sf_cancelar_caixa_almoxarifado(teste_almox_id('PMOZ01', '96100'), 'teste Z1h');
  perform pg_temp.confere(n = 500, 'Z1h cancelar a caixa tocada devolve 500 (veio ' || n || ')');
  select * into e from sf_estoque_envios where bipe = 'CX[2][500]9601-PMOZ01' and operacao = 'estorno';
  perform pg_temp.confere(e.quantidade = 500, 'Z1h estorno de 500 (veio ' || coalesce(e.quantidade::text, 'nada') || ')');
  perform pg_temp.confere(
    (select estornado from sf_estoque_envios where bipe = 'CX[2][500]9601-PMOZ01' and operacao = 'entrada') = 500,
    'Z1h saldo estornado 500');
end $t$;

-- Z1i. Etiqueta CX[3][500] com só 9 painéis: entram 450, a etiqueta dizia 500 (divergência em placas).
select public.teste_caixa_placas('PMOZ01', '9601', 3, 96200, 9, 500);
select pg_temp.confere(
  sf_almoxarifado_entrada('PMOZ01', '9601', 'Almoxarifado', 'Ana', 'CX[3][500]9601-PMOZ01', 'caixa', 500, '')
    = '{"ok": true, "quantidade": 450, "qtd_etiqueta": 500}'::jsonb,
  'Z1i divergência em placas: 450 entraram, etiqueta 500');
select pg_temp.confere(
  (select quantidade from sf_estoque_envios where bipe = 'CX[3][500]9601-PMOZ01' and operacao = 'entrada') = 450,
  'Z1i fila com o que entrou (450)');

-- Z1j. Posto anterior (Inspeção Saída, gate aprovado): 4 de 10 painéis aprovados → faltam 300 de 500.
select public.teste_caixa_placas('PMOZ02', '9602', 1, 96500, 10, 500);
select teste_reg('PMOZ02', '9602', 'Inspeção Saída', s::text, 'Aprovado') from generate_series(96500, 96503) s;
select pg_temp.confere(
  (select r->>'motivo' = 'posto_anterior_nao_concluido' and (r->>'faltam')::int = 300 and (r->>'pecas')::int = 500
          and r->>'detalhe' like '%: 300 de 500 peças sem aprovação.'
     from (select sf_almoxarifado_entrada('PMOZ02', '9602', 'Almoxarifado', 'Ana', 'CX[1][500]9602-PMOZ02',
                                          'caixa', 500, '') as r) x),
  'Z1j posto anterior em placas: '
    || sf_almoxarifado_entrada('PMOZ02', '9602', 'Almoxarifado', 'Ana', 'CX[1][500]9602-PMOZ02', 'caixa', 500, '')::text);

-- =============================================================
-- Z2. Peças avulsas (OP individual, anterior Embalagem), N = 50
-- =============================================================
select teste_reg('PMOZ03', '9603', 'Embalagem', s::text, '', s::text, now() - interval '1 hour')
  from generate_series(9701, 9703) s;
-- 2ª linha do 9701 na Embalagem: não pode virar 100 placas.
select teste_reg('PMOZ03', '9603', 'Embalagem', '9701', '', '9701', now() - interval '30 minutes');

select pg_temp.confere(
  (select pecas from sf_almox_pendencias() p where p.pmo = 'PMOZ03' and p.tipo = 'peca') = 150,
  'Z2a pendência das peças avulsas em placas (150)');
select pg_temp.confere(
  (select (d->>'pecas')::int = 150 and (d->>'paineis')::int = 3 and jsonb_array_length(d->'sns') = 3
     from sf_almox_detalhe('PMOZ03', '9603', 'AVULSAS', null) d),
  'Z2a detalhe AVULSAS: pecas 150, paineis 3, 3 SNs: ' || sf_almox_detalhe('PMOZ03', '9603', 'AVULSAS', null)::text);

do $t$
declare r jsonb; e record;
begin
  r := sf_almoxarifado_entrada('PMOZ03', '9603', 'Almoxarifado', 'Ana', '9701', 'serie', 1, '9701');
  perform pg_temp.confere(r = '{"ok": true, "quantidade": 50}'::jsonb, 'Z2b entrada da peça: 50: ' || r::text);
  select * into e from sf_estoque_envios where pmo = 'PMOZ03' and alvo = '9701' and operacao = 'entrada';
  perform pg_temp.confere(e.quantidade = 50 and e.tipo = 'serie', 'Z2b fila: 50 (veio ' || e.quantidade || ')');
  perform pg_temp.confere(
    (select pecas from sf_almox_pendencias() p where p.pmo = 'PMOZ03' and p.tipo = 'peca') = 100,
    'Z2c pendência cai pra 100');
  perform pg_temp.confere(
    (sf_almox_detalhe('PMOZ03', '9603', 'AVULSAS', null)->>'recebidas_op')::int = 50,
    'Z2c recebidas_op 50');

  -- Cancelar a peça com a fila LIMPA: reverte 50 → a entrada inteira é cancelada (e não ajustada pra 49).
  perform sf_cancelar_lancamento(teste_almox_id('PMOZ03', '9701'), 'teste Z2d');
  select * into e from sf_estoque_envios where pmo = 'PMOZ03' and alvo = '9701' and operacao = 'entrada';
  perform pg_temp.confere(e.cancelado_em is not null and e.quantidade = 50,
    'Z2d cancelar a peça cancela a entrada de 50 (quantidade ' || e.quantidade
      || ', cancelada ' || (e.cancelado_em is not null) || ')');

  -- Peça TOCADA: cancelar estorna 50.
  r := sf_almoxarifado_entrada('PMOZ03', '9603', 'Almoxarifado', 'Ana', '9702', 'serie', 1, '9702');
  update sf_estoque_envios set tentativas = 1 where pmo = 'PMOZ03' and alvo = '9702' and operacao = 'entrada';
  perform sf_cancelar_lancamento(teste_almox_id('PMOZ03', '9702'), 'teste Z2e');
  perform pg_temp.confere(
    (select quantidade from sf_estoque_envios where pmo = 'PMOZ03' and alvo = '9702' and operacao = 'estorno') = 50,
    'Z2e estorno da peça tocada = 50');
end $t$;

-- =============================================================
-- Z3. Lote do NQA individual de 4 painéis, N = 50
-- =============================================================
select teste_reg('PMOZ04', '9604', 'Embalagem', s::text, '', s::text, now() - interval '1 hour')
  from generate_series(9801, 9808) s;
select teste_lote('PMOZ04', '9604', array['9801','9802','9803','9804'], 'Aprovado');
select teste_lote('PMOZ04', '9604', array['9805','9806','9807','9808'], 'Aprovado');

do $t$
declare v record; r jsonb; e record; v_lote uuid; v_lote_b uuid; n int;
begin
  select distinct nqa_lote_id into v_lote from sf_registros where pmo = 'PMOZ04' and numero_serie_norm = '9801'
     and nqa_lote_id is not null;
  select distinct nqa_lote_id into v_lote_b from sf_registros where pmo = 'PMOZ04' and numero_serie_norm = '9805'
     and nqa_lote_id is not null;

  select * into v from sf_almox_lotes('PMOZ04', '9604') l where l.lote_id = v_lote;
  perform pg_temp.confere(v.pecas = 200 and v.amostra = 4 and cardinality(v.sns) = 4 and v.ja_lancadas = 0
      and v.rotulo like '%][4]',
    'Z3a lista do lote: pecas 200 (placas), amostra 4 e rótulo [4] (painéis): ' || row_to_json(v)::text);
  perform pg_temp.confere(
    (select pecas = 200 and amostra = 4 from sf_almox_pendencias() p where p.lote_id = v_lote),
    'Z3b pendência do lote: pecas 200, amostra 4');
  perform pg_temp.confere(
    (select (d->>'pecas')::int = 200 and (d->>'amostra')::int = 4 and jsonb_array_length(d->'sns') = 4
       from sf_almox_detalhe('PMOZ04', '9604', '', v_lote) d),
    'Z3b detalhe do lote: pecas 200, amostra 4');

  -- Ainda exige os 4 SNs (painéis).
  r := sf_almoxarifado_lote('PMOZ04', '9604', 'Almoxarifado', 'Ana', v_lote, array['9801','9802','9803']);
  perform pg_temp.confere(r->>'motivo' = 'lote_incompleto' and (r->>'pecas')::int = 4
      and (r->>'bipados')::int = 3 and (r->>'faltam')::int = 1
      and r->>'detalhe' = 'Bipe todos os 4 painéis do lote: faltam 1.',
    'Z3c lote incompleto em painéis: ' || r::text);

  r := sf_almoxarifado_lote('PMOZ04', '9604', 'Almoxarifado', 'Ana', v_lote, array['9801','9802','9803','9804']);
  perform pg_temp.confere(r->>'ok' = 'true' and (r->>'quantidade')::int = 200 and r->>'lote' like '%][4]',
    'Z3d confirmação: quantidade 200 (placas), rótulo [4]: ' || r::text);
  select * into e from sf_estoque_envios where lote_id = v_lote and operacao = 'entrada';
  perform pg_temp.confere(e.quantidade = 200 and cardinality(e.sns) = 4 and e.tipo = 'lote',
    'Z3d fila do lote: quantidade 200, 4 SNs (veio ' || e.quantidade || ')');
  perform pg_temp.confere(
    (select count(*) = 4 and sum(pecas) = 200 from sf_registros where envio_id = e.id),
    'Z3d 4 linhas de 50 placas no Almoxarifado');

  -- Cancelar o lote TOCADO: devolve 200 e estorna 200.
  update sf_estoque_envios set tentativas = 1 where id = e.id;
  n := sf_cancelar_lote_almoxarifado(teste_almox_id('PMOZ04', '9801'), 'teste Z3e');
  perform pg_temp.confere(n = 200, 'Z3e cancelar o lote devolve 200 (veio ' || n || ')');
  perform pg_temp.confere(
    (select quantidade from sf_estoque_envios where entrada_id = e.id and operacao = 'estorno') = 200,
    'Z3e estorno de 200');

  -- Z3f. Um SN do lote B entrou "por fora": a lista diz 50 placas já lançadas, a confirmação recusa em placas.
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm)
  values ('Fora', 'Almoxarifado', 'PMOZ04', '9604', 'Cliente Z', '9805', '9805');
  select * into v from sf_almox_lotes('PMOZ04', '9604') l where l.lote_id = v_lote_b;
  perform pg_temp.confere(v.pecas = 200 and v.ja_lancadas = 50 and v.amostra = 4,
    'Z3f lista: ja_lancadas 50 placas: ' || row_to_json(v)::text);
  r := sf_almoxarifado_lote('PMOZ04', '9604', 'Almoxarifado', 'Ana', v_lote_b, array['9805','9806','9807','9808']);
  perform pg_temp.confere(r->>'motivo' = 'lote_com_sn_lancado'
      and r->>'detalhe' like '50 de 200 peças deste lote já têm entrada no Almoxarifado (9805).%',
    'Z3f recusa em placas: ' || r::text);
end $t$;

-- =============================================================
-- Z5. Controle N = 1: os números de antes
-- =============================================================
select public.teste_caixa_placas('PMOZ05', '9605', 1, 96900, 3, 3);
do $t$
declare r jsonb;
begin
  perform pg_temp.confere(
    (select pecas from sf_almox_necessidades('PMOZ05', '9605')) = 3, 'Z5 necessidade N=1 = 3');
  r := sf_almoxarifado_entrada('PMOZ05', '9605', 'Almoxarifado', 'Ana', 'CX[1][3]9605-PMOZ05', 'caixa', 3, '');
  perform pg_temp.confere(r = '{"ok": true, "quantidade": 3}'::jsonb, 'Z5 entrada N=1: ' || r::text);
  perform sf_cancelar_lancamento(teste_almox_id('PMOZ05', '96902'), 'teste Z5');
  perform pg_temp.confere(
    (select quantidade from sf_estoque_envios where bipe = 'CX[1][3]9605-PMOZ05' and operacao = 'entrada') = 2,
    'Z5 cancelar uma linha N=1 ajusta pra 2');
  perform pg_temp.confere(
    sf_cancelar_caixa_almoxarifado(teste_almox_id('PMOZ05', '96900'), 'teste Z5') = 2,
    'Z5 cancelar a caixa N=1 devolve 2');
end $t$;

do $t$ begin perform public.teste_fila_invariantes('fim do placas_almoxarifado_test'); end $t$;
select 'PLACAS ALMOXARIFADO SQL OK' as resultado;
