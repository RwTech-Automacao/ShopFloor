-- Testes da 0158 (hora `em` na lista de pendências) e da 0159 (sf_almox_detalhe): a tela do Almoxarifado
-- em cartões de pendência. Roda DEPOIS do almoxarifado_test.sql, do almoxarifado_necessidade_test.sql e do
-- almoxarifado_lote_test.sql, na mesma base (reaproveita stubs, perfis, postos e os atalhos teste_reg,
-- teste_caixa e teste_lote). Massa PRÓPRIA em OPs novas (PMOQ*), sem depender do que os outros deixam.
-- Runner: supabase/tests/rodar-almoxarifado-test.sh

-- O stub de sf_ordens não tem `status` nem `qtd` (colunas reais de produção que a 0158/0159 leem).
alter table public.sf_ordens add column if not exists status text;
alter table public.sf_ordens add column if not exists qtd int;

\i /tmp/0158.sql
\i /tmp/0159.sql

select set_config('teste.perms',
  'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);

insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim, embalagem_individual, status, qtd) values
  ('PMOQ01', '9401', 'Cliente Q', '8000', '8100', false, 'EM PRODUCAO', 20),  -- coletiva, anterior = Embalagem
  ('PMOQ02', '9402', 'Cliente Q', '8100', '8200', true,  'EM PRODUCAO', 10),  -- individual, anterior = Inspeção NQA
  ('PMOQ03', '9403', 'Cliente Q', '8200', '8300', false, 'FINALIZADA',  6),   -- finalizada: não aparece
  ('PMOQ04', '9404', 'Cliente Q', '8300', '8400', false, 'EM PRODUCAO', 6);   -- sem Almoxarifado na rota
do $t$ begin
  perform public.teste_op_postos('PMOQ01', '9401', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOQ02', '9402', array['Embalagem', 'Inspeção NQA', 'Almoxarifado']);
  perform public.teste_op_postos('PMOQ03', '9403', array['Embalagem', 'Almoxarifado']);
  perform public.teste_op_postos('PMOQ04', '9404', array['Embalagem', 'Inspeção NQA']);
end $t$;

-- =============================================================
-- Q1. sf_almox_pendencias: `em` = fechada_em da caixa / aprovado_em do lote; finalizada e sem Almoxarifado fora
-- =============================================================
do $t$
declare v record; n int; v_fech timestamptz := now() - interval '3 hours';
        v_cod text; v_lote uuid; v_aprov timestamptz;
begin
  v_cod := teste_caixa('PMOQ01', '9401', 1, 8000, 5);
  update sf_caixas set fechada_em = v_fech where pmo = 'PMOQ01' and codigo = v_cod;
  perform teste_caixa('PMOQ03', '9403', 1, 8200, 3);   -- finalizada
  perform teste_caixa('PMOQ04', '9404', 1, 8300, 3);   -- sem Almoxarifado

  perform teste_reg('PMOQ02', '9402', 'Embalagem', s::text, '', s::text) from generate_series(8101, 8105) s;
  v_lote := teste_lote('PMOQ02', '9402', array['8101','8102','8103','8104','8105'], 'Aprovado');
  select max(data_hora) into v_aprov from sf_registros where nqa_lote_id = v_lote;

  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOQ01';
  if v.tipo <> 'caixa' or v.codigo <> v_cod or v.pecas <> 5 or v.em is distinct from v_fech then
    raise exception 'FALHOU (Q1): caixa listada errada: %', row_to_json(v); end if;

  select * into v from sf_almox_pendencias() p where p.pmo = 'PMOQ02';
  if v.tipo <> 'lote' or v.lote_id <> v_lote or v.pecas <> 5 or v.em is distinct from v_aprov
     or v.em is null then
    raise exception 'FALHOU (Q1): lote listado errado: % (aprovado_em=%)', row_to_json(v), v_aprov; end if;

  select count(*) into n from sf_almox_pendencias() p where p.pmo in ('PMOQ03', 'PMOQ04');
  if n <> 0 then raise exception 'FALHOU (Q1): finalizada/sem Almoxarifado apareceram (% linhas)', n; end if;

  -- sem permissão: ERRO, não lista vazia
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform * from sf_almox_pendencias();
    raise exception 'FALHOU (Q1): sem permissão não deu erro';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);
  raise notice 'Q1. sf_almox_pendencias: em = fechada_em / aprovado_em; finalizada e sem Almoxarifado fora; sem permissão = erro: ok';
end $t$;

-- =============================================================
-- Q2. sf_almox_detalhe de CAIXA
-- =============================================================
do $t$
declare r jsonb; v_cod text; v_fech timestamptz; v_t0 timestamptz := now() - interval '2 hours';
begin
  select codigo, fechada_em into v_cod, v_fech from sf_caixas where pmo = 'PMOQ01' and op = '9401';
  -- Dois operadores na Embalagem: o ÚLTIMO registro (maior data_hora) é o de Marcos.
  update sf_registros set colaborador = 'Ana',    data_hora = v_t0                       where numero_caixa = v_cod and posto = 'Embalagem';
  update sf_registros set colaborador = 'Marcos', data_hora = v_t0 + interval '30 min'   where numero_caixa = v_cod and posto = 'Embalagem' and numero_serie_norm = '8002';
  -- um SN duplicado (mesmo SN em duas linhas) não pode repetir no array
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_caixa, numero_serie, numero_serie_norm, data_hora)
  values ('Ana', 'Embalagem', 'PMOQ01', '9401', 'Cliente Q', v_cod, '8000', '8000', v_t0 + interval '5 min');

  r := sf_almox_detalhe('PMOQ01', '9401', v_cod);
  if r->>'ok' <> 'true' or r->>'tipo' <> 'caixa' or r->>'codigo' <> v_cod or (r->>'pecas')::int <> 5
     or r->'sns' <> '["8000","8001","8002","8003","8004"]'::jsonb
     or (r->>'fechada_em')::timestamptz is distinct from v_fech
     or r->>'fechada_por' <> 'Marcos' then
    raise exception 'FALHOU (Q2): detalhe da caixa: %', r; end if;
  if (r->>'qtd_op')::int <> 20 or (r->>'recebidas_op')::int <> 0 then
    raise exception 'FALHOU (Q2): qtd_op/recebidas_op antes da entrada: %', r; end if;
  if r->'posto_anterior' <> jsonb_build_object('posto', 'Embalagem', 'recurso', 'caixa',
                                               'precisa_aprovado', false) then
    raise exception 'FALHOU (Q2): posto_anterior: %', r->'posto_anterior'; end if;

  -- depois da entrada, recebidas_op conta os SNs distintos no Almoxarifado
  perform teste_aceito(sf_almoxarifado_entrada('PMOQ01','9401','Almoxarifado','Ana', v_cod,'caixa',5,''), 5, 'Q2 entrada');
  r := sf_almox_detalhe('PMOQ01', '9401', v_cod);
  if (r->>'recebidas_op')::int <> 5 then
    raise exception 'FALHOU (Q2): recebidas_op depois da entrada: %', r; end if;
  raise notice 'Q2. sf_almox_detalhe de caixa: sns, fechada_em, fechada_por, qtd_op, recebidas_op, posto_anterior: ok';
end $t$;

-- =============================================================
-- Q3. sf_almox_detalhe de LOTE
-- =============================================================
do $t$
declare r jsonb; v_lote uuid; v_aprov timestamptz;
begin
  select distinct nqa_lote_id into v_lote from sf_registros where pmo = 'PMOQ02' and nqa_lote_id is not null;
  select max(data_hora) into v_aprov from sf_registros where nqa_lote_id = v_lote;
  r := sf_almox_detalhe('PMOQ02', '9402', null, v_lote);
  if r->>'ok' <> 'true' or r->>'tipo' <> 'lote' or (r->>'pecas')::int <> 5
     or (r->>'amostra')::int <> 5 or sf_almox_lote_amostra(5) <> 5
     or r->'sns' <> '["8101","8102","8103","8104","8105"]'::jsonb
     or (r->>'aprovado_em')::timestamptz is distinct from v_aprov
     or (r->>'ja_lancadas')::int <> 0
     or r->>'rotulo' <> sf_almox_lote_rotulo(v_lote, 5) then
    raise exception 'FALHOU (Q3): detalhe do lote: %', r; end if;
  if (r->>'qtd_op')::int <> 10 or (r->>'recebidas_op')::int <> 0
     or r->'posto_anterior'->>'recurso' <> 'nqa' or (r->'posto_anterior'->>'precisa_aprovado')::boolean is not true then
    raise exception 'FALHOU (Q3): campos comuns: %', r; end if;
  raise notice 'Q3. sf_almox_detalhe de lote: sns, amostra (= todas as peças), aprovado_em, ja_lancadas, rótulo: ok';
end $t$;

-- =============================================================
-- Q4. Falhas como dado e sem permissão como erro
-- =============================================================
do $t$
declare r jsonb; v_cod text;
begin
  r := sf_almox_detalhe('PMOX99', '0000', 'x');
  if r <> '{"ok": false, "motivo": "op_inexistente"}'::jsonb then raise exception 'FALHOU (Q4): %', r; end if;
  r := sf_almox_detalhe('PMOQ04', '9404', 'x');
  if r <> '{"ok": false, "motivo": "sem_almoxarifado"}'::jsonb then raise exception 'FALHOU (Q4): %', r; end if;
  r := sf_almox_detalhe('PMOQ01', '9401', 'CX[99][1]9401-PMOQ01');
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (Q4) caixa: %', r; end if;
  -- caixa ABERTA também é item inexistente
  v_cod := teste_caixa('PMOQ01', '9401', 2, 8050, 2, false);
  r := sf_almox_detalhe('PMOQ01', '9401', v_cod);
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (Q4) aberta: %', r; end if;
  r := sf_almox_detalhe('PMOQ02', '9402', null, gen_random_uuid());
  if r <> '{"ok": false, "motivo": "item_inexistente"}'::jsonb then raise exception 'FALHOU (Q4) lote: %', r; end if;

  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  begin
    perform sf_almox_detalhe('PMOQ01', '9401', 'x');
    raise exception 'FALHOU (Q4): sem permissão não deu erro';
  exception when others then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  perform set_config('teste.perms', 'recebimento.lancar,shopfloor.lancar,shopfloor.visualizar,lancar', false);
  raise notice 'Q4. falhas como dado (op_inexistente, sem_almoxarifado, item_inexistente) e sem permissão = erro: ok';
end $t$;
