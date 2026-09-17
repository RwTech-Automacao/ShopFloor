-- Stubs mínimos do Supabase/ShopFloor
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('teste.uid', true), '')::uuid $f$;
create table public.usuarios (id uuid primary key, nome text not null default '');
create table public.sf_ordens (pmo text, op text, cliente text default '', descricao text default '', status text default '', sn_ini text default '', sn_fim text default '', unique (pmo, op));
create function public.tem_permissao(m text, p text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',') like '%,' || m || '.' || p || ',%'
$f$;
insert into public.usuarios values ('00000000-0000-0000-0000-000000000001', 'Operador Teste');
insert into public.sf_ordens (pmo, op, cliente, sn_ini, sn_fim) values
  ('PMOG13', '9001', 'CLIENTE', '2690010001', '2690010100'),
  ('PMOG13', '9002', 'CLIENTE', '', '');
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);
\i /tmp/0111.sql
\i /tmp/0112.sql

-- 1. Helpers
select set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
do $t$ begin
  if st_rolo_prefixo('capj41-0001') <> 'CAPJ41' then raise exception 'FALHOU: prefixo'; end if;
  if st_rolo_sequencial('CAPJ41-0001-22') <> '0001-22' then raise exception 'FALHOU: sequencial'; end if;
  if st_rolo_prefixo('CAPJ41') <> '' then raise exception 'FALHOU: sem separador'; end if;
  if st_face('bot e top') <> 'TOP E BOT' then raise exception 'FALHOU: face'; end if;
  if st_sn_na_faixa('2690010001', '2690010100', '2690010050') is not true then raise exception 'FALHOU: faixa dentro'; end if;
  if st_sn_na_faixa('2690010001', '2690010100', '2690010101') is not false then raise exception 'FALHOU: faixa fora'; end if;
  if st_sn_na_faixa('', '', '123') is not null then raise exception 'FALHOU: sem faixa'; end if;
  if st_rolo_chave('capj41-0001') <> 'CAPJ41-1' or st_rolo_chave('CAPJ41 1') <> 'CAPJ41-1' or st_rolo_chave('CAPJ41_01') <> 'CAPJ41-1' then raise exception 'FALHOU: chave do rolo'; end if;
  if st_rolo_chave('CAPJ41') is not null or st_rolo_chave(null) is not null then raise exception 'FALHOU: chave de rolo inválido'; end if;
  if st_sn_na_faixa('A', 'Z', 'b') is not false then raise exception 'FALHOU: faixa lexical na ordem C'; end if;
end $t$;

-- 2. Estrutura
do $t$ declare r jsonb; begin
  r := st_importar_estrutura('PMOG13', '[{"componente":"capj41","processo":"SMD"},{"componente":"RESR85","processo":"SMD"},{"componente":"BAR180","processo":"PTH"}]');
  if r->>'novos' <> '3' then raise exception 'FALHOU: importar novos %', r; end if;
  r := st_importar_estrutura('PMOG13', '[{"componente":"CAPJ41","processo":"SMD"},{"componente":"BAR180","processo":"SMD"}]');
  if r->>'iguais' <> '1' or r->>'atualizados' <> '1' then raise exception 'FALHOU: reimportar %', r; end if;
  update st_estrutura set processo = 'PTH' where componente = 'BAR180';
  r := st_importar_estrutura('PMOG13', '[{"componente":"DUP1","processo":"SMD"},{"componente":"dup1","processo":"PTH"},{"componente":"DUP1 ","processo":"pth"}]');
  if r->>'novos' <> '1' or r->>'atualizados' <> '0' or r->>'iguais' <> '0' then raise exception 'FALHOU: importar deduplica %', r; end if;
  if (select processo from st_estrutura where pmo = 'PMOG13' and componente = 'DUP1') <> 'PTH' then raise exception 'FALHOU: última ocorrência vale'; end if;
  begin perform st_importar_estrutura('PMOX', '[]'); raise exception 'FALHOU: pmo inexistente passou';
  exception when others then if sqlerrm not like '%PMO_INEXISTENTE%' then raise; end if; end;
end $t$;

-- 3. Abrir setup + faixa + face sobreposta
do $t$ declare r jsonb; begin
  r := st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'TOP', '2690010001');
  if (r->>'criado')::boolean is not true then raise exception 'FALHOU: criar %', r; end if;
  r := st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'top', '2690010001');
  if (r->>'criado')::boolean is not false or (r->>'sem_faixa')::boolean is not false then raise exception 'FALHOU: reabrir %', r; end if;
  begin perform st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'TOP E BOT', '2690010001'); raise exception 'FALHOU: face sobreposta passou';
  exception when others then if sqlerrm not like '%FACE_SOBREPOSTA%' then raise; end if; end;
  begin perform st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'BOT', '999'); raise exception 'FALHOU: sn fora passou';
  exception when others then if sqlerrm not like '%SN_FORA_DA_FAIXA%' then raise; end if; end;
  r := st_abrir_setup('PMOG13', '9002', 'SMD', '1', 'YSM10', 'TOP', 'QUALQUER');
  if (r->>'sem_faixa')::boolean is not true then raise exception 'FALHOU: sem faixa %', r; end if;
end $t$;

-- 4. Montagem
do $t$ declare s uuid; r jsonb; begin
  select id into s from st_setups where op = '9001';
  r := st_incluir_item(s, '36', 'zsy-1', 'CAPJ41-L1R1');
  if r->>'componente' <> 'CAPJ41' then raise exception 'FALHOU: incluir %', r; end if;
  begin perform st_incluir_item(s, '37', 'ZSY-2', 'XXX99-1'); raise exception 'FALHOU: fora da estrutura';
  exception when others then if sqlerrm not like '%COMPONENTE_FORA_DA_ESTRUTURA%' then raise; end if; end;
  begin perform st_incluir_item(s, '37', 'ZSY-2', 'BAR180-1'); raise exception 'FALHOU: outro processo';
  exception when others then if sqlerrm not like '%COMPONENTE_OUTRO_PROCESSO%' then raise; end if; end;
  begin perform st_incluir_item(s, '36', 'ZSY-9', 'RESR85-1'); raise exception 'FALHOU: posição com outro feeder';
  exception when others then if sqlerrm not like '%POSICAO_COM_OUTRO_FEEDER%' then raise; end if; end;
  begin perform st_incluir_item(s, '38', 'ZSY-1', 'RESR85-1'); raise exception 'FALHOU: feeder em outra posição';
  exception when others then if sqlerrm not like '%FEEDER_EM_OUTRA_POSICAO%' then raise; end if; end;
  begin perform st_incluir_item(s, '38', 'ZSY-3', 'CAPJ41-L1R1'); raise exception 'FALHOU: rolo repetido';
  exception when others then if sqlerrm not like '%ROLO_JA_MONTADO%' then raise; end if; end;
  begin perform st_incluir_item(s, '38', 'ZSY-3', 'RESR85'); raise exception 'FALHOU: rolo inválido';
  exception when others then if sqlerrm not like '%ROLO_INVALIDO%' then raise; end if; end;
  perform st_incluir_item(s, '38', 'ZSY-3', 'RESR85-L2R7');
end $t$;

-- 5. Liberar e trocar rolo
do $t$ declare s uuid; r jsonb; begin
  select id into s from st_setups where op = '9001';
  begin perform st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R2', '2690010010'); raise exception 'FALHOU: troca sem liberar';
  exception when others then if sqlerrm not like '%SETUP_NAO_LIBERADO%' then raise; end if; end;
  perform st_liberar_setup(s);
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R2', '2690010010');
  if r->>'resultado' <> 'APROVADO' then raise exception 'FALHOU: aprovada %', r; end if;
  if (select rolo from st_setup_itens where setup_id = s and posicao = '36') <> 'CAPJ41-L1R2' then raise exception 'FALHOU: rolo montado não atualizou'; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R3', '2690010010');
  if r->>'resultado' <> 'REPROVADO' or (r->'motivos'->>0) not like 'O rolo montado na posição 36 é CAPJ41-L1R2%' then raise exception 'FALHOU: rolo antigo %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R2', 'RESR85-L9', '2690010010');
  if r->>'resultado' <> 'REPROVADO' or (r->'motivos'->>0) not like 'Componente diferente%' then raise exception 'FALHOU: componente %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R2', 'CAPJ41-L1R2', '2690010010');
  if (r->'motivos'->>0) <> 'O rolo que entra é o mesmo que sai.' then raise exception 'FALHOU: mesmo rolo %', r; end if;
  r := st_trocar_rolo(s, '99', 'ZSY-1', 'CAPJ41-L1R2', 'CAPJ41-L1R4', '2690019999');
  if cardinality(array(select jsonb_array_elements_text(r->'motivos'))) <> 2 then raise exception 'FALHOU: dois motivos %', r; end if;
  if (select count(*) from st_trocas where setup_id = s) <> 5 then raise exception 'FALHOU: toda tentativa grava'; end if;
  if (select rolo from st_setup_itens where setup_id = s and posicao = '36') <> 'CAPJ41-L1R2' then raise exception 'FALHOU: reprovada mudou o rolo'; end if;
end $t$;

-- 6. Cópia e permissões
do $t$ declare s uuid; nova jsonb; n uuid; begin
  select id into s from st_setups where op = '9001';
  nova := st_abrir_setup('PMOG13', '9002', 'SMD', '1', 'YSM10', 'BOT', 'X');
  begin perform st_abrir_setup('PMOG13', '9002', 'SMD', '2', 'YSM10', 'TOP', 'X', s); raise exception 'FALHOU: cópia incompatível';
  exception when others then if sqlerrm not like '%COPIA_INCOMPATIVEL%' then raise; end if; end;
end $t$;
-- cópia compatível: outra OP, mesma máquina e face do 9001 (TOP)
insert into public.sf_ordens (pmo, op, sn_ini, sn_fim) values ('PMOG13', '9003', '', '');
do $t$ declare s uuid; nova jsonb; n uuid; begin
  select id into s from st_setups where op = '9001';
  nova := st_abrir_setup('PMOG13', '9003', 'SMD', '1', 'YSM10', 'TOP', 'X', s);
  n := (nova->>'setup_id')::uuid;
  if (select count(*) from st_setup_itens where setup_id = n and rolo is null) <> 2 then raise exception 'FALHOU: cópia sem rolos'; end if;
  begin perform st_incluir_item(n, '36', 'ZSY-1', 'RESR85-A'); raise exception 'FALHOU: componente diferente da posição';
  exception when others then if sqlerrm not like '%COMPONENTE_DIFERENTE_DA_POSICAO%' then raise; end if; end;
  if (st_incluir_item(n, '36', 'ZSY-1', 'CAPJ41-NOVO')->>'atualizou')::boolean is not true then raise exception 'FALHOU: preencher rolo da cópia'; end if;
  begin perform st_liberar_setup(n); raise exception 'FALHOU: liberar com rolo faltando';
  exception when others then if sqlerrm not like '%FALTA_ROLO%' then raise; end if; end;
end $t$;
select set_config('teste.perms', 'setup.visualizar,setup.lancar', false);
do $t$ declare s uuid; i uuid; begin
  select id into s from st_setups where op = '9001';
  select id into i from st_setup_itens where setup_id = s and posicao = '36';
  begin perform st_editar_item(i, '40', 'ZSY-1'); raise exception 'FALHOU: editar sem admin';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
  begin perform st_remover_item(i); raise exception 'FALHOU: remover de setup liberado sem admin';
  exception when others then if sqlerrm not like '%SETUP_LIBERADO%' then raise; end if; end;
end $t$;
select set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
do $t$ declare s uuid; i uuid; begin
  select id into s from st_setups where op = '9001';
  select id into i from st_setup_itens where setup_id = s and posicao = '36';
  perform st_editar_item(i, '36', 'ZSY-NOVO');
  if (select tipo from st_alteracoes where item_id = i order by data_hora desc limit 1) <> 'troca_feeder' then raise exception 'FALHOU: histórico da edição'; end if;
end $t$;
-- 7. Chave canônica do rolo, remoção, edição, histórico do admin, erros de abertura
insert into public.sf_ordens (pmo, op, sn_ini, sn_fim) values ('PMOG13', '9004', '2690040001', '2690040100');
do $t$ declare s uuid; r jsonb; i2 uuid; i3 uuid; n int; begin
  r := st_abrir_setup('PMOG13', '9004', 'SMD', '2', 'YSM10', 'TOP', '2690040001');
  s := (r->>'setup_id')::uuid;
  perform st_incluir_item(s, '1', 'F1', 'CAPJ41-1');
  if (select rolo_chave from st_setup_itens where setup_id = s and posicao = '1') <> 'CAPJ41-1' then raise exception 'FALHOU: rolo_chave gravada'; end if;
  begin perform st_incluir_item(s, '2', 'F2', 'CAPJ41-0001'); raise exception 'FALHOU: rolo com zeros à esquerda passou';
  exception when others then if sqlerrm not like '%ROLO_JA_MONTADO%' then raise; end if; end;
  begin perform st_incluir_item(s, '2', 'F2', 'capj41 1'); raise exception 'FALHOU: rolo com outro separador passou';
  exception when others then if sqlerrm not like '%ROLO_JA_MONTADO%' then raise; end if; end;
  i2 := (st_incluir_item(s, '2', 'F2', 'RESR85-5')->>'item_id')::uuid;
  -- remoção em montagem: some sem histórico
  i3 := (st_incluir_item(s, '3', 'F3', 'RESR85-6')->>'item_id')::uuid;
  perform st_remover_item(i3);
  if exists (select 1 from st_setup_itens where id = i3) then raise exception 'FALHOU: remover em montagem'; end if;
  if exists (select 1 from st_alteracoes where setup_id = s) then raise exception 'FALHOU: remoção em montagem gravou histórico'; end if;
  begin perform st_remover_item(i3); raise exception 'FALHOU: remover duas vezes';
  exception when others then if sqlerrm not like '%ITEM_INEXISTENTE%' then raise; end if; end;
  perform st_incluir_item(s, '3', 'F3', 'CAPJ41-7');
  -- edição com unicidade SMD
  begin perform st_editar_item(i2, '1', 'F2'); raise exception 'FALHOU: editar p/ posição ocupada';
  exception when others then if sqlerrm not like '%POSICAO_COM_OUTRO_FEEDER%' then raise; end if; end;
  begin perform st_editar_item(i2, '2', 'F1'); raise exception 'FALHOU: editar p/ feeder ocupado';
  exception when others then if sqlerrm not like '%FEEDER_EM_OUTRA_POSICAO%' then raise; end if; end;

  perform st_liberar_setup(s);
  -- troca com rolo que sai escrito com outro zero-padding: aprovada
  r := st_trocar_rolo(s, '1', 'F1', 'CAPJ41-001', 'CAPJ41-2', '2690040010');
  if r->>'resultado' <> 'APROVADO' then raise exception 'FALHOU: troca com zeros %', r; end if;
  if (select rolo || '|' || rolo_chave from st_setup_itens where setup_id = s and posicao = '1') <> 'CAPJ41-2|CAPJ41-2' then raise exception 'FALHOU: troca atualiza rolo e chave'; end if;
  -- rolo que entra já montado em outra posição
  r := st_trocar_rolo(s, '1', 'F1', 'CAPJ41-2', 'CAPJ41-007', '2690040010');
  if r->>'resultado' <> 'REPROVADO' or r->'motivos' <> '["O rolo CAPJ41-007 já está montado na posição 3."]'::jsonb then raise exception 'FALHOU: já montado %', r; end if;
  -- mesmo rolo com zeros diferentes
  r := st_trocar_rolo(s, '1', 'F1', 'CAPJ41-2', 'CAPJ41-02', '2690040010');
  if r->'motivos' <> '["O rolo que entra é o mesmo que sai."]'::jsonb then raise exception 'FALHOU: mesmo rolo pela chave %', r; end if;
  -- admin num setup liberado: inclusão e remoção gravam histórico
  i3 := (st_incluir_item(s, '4', 'F4', 'RESR85-9')->>'item_id')::uuid;
  perform st_remover_item(i3);
  if (select count(*) from st_alteracoes where setup_id = s and item_id = i3 and tipo = 'inclusao') <> 1 then raise exception 'FALHOU: histórico de inclusão'; end if;
  if (select count(*) from st_alteracoes where setup_id = s and item_id = i3 and tipo = 'remocao') <> 1 then raise exception 'FALHOU: histórico de remoção'; end if;

  -- SETUP_VAZIO, EQUIPAMENTO_INVALIDO, PROCESSO_INVALIDO
  r := st_abrir_setup('PMOG13', '9004', 'SMD', '2', 'YSM10', 'BOT', '2690040001');
  begin perform st_liberar_setup((r->>'setup_id')::uuid); raise exception 'FALHOU: liberar vazio';
  exception when others then if sqlerrm not like '%SETUP_VAZIO%' then raise; end if; end;
  begin perform st_abrir_setup('PMOG13', '9004', 'SMD', '9', 'XYZ', 'TOP', '2690040001'); raise exception 'FALHOU: equipamento inválido';
  exception when others then if sqlerrm not like '%EQUIPAMENTO_INVALIDO%' then raise; end if; end;
  begin perform st_abrir_setup('PMOG13', '9004', 'ABC', '2', 'YSM10', 'TOP', '2690040001'); raise exception 'FALHOU: processo inválido';
  exception when others then if sqlerrm not like '%PROCESSO_INVALIDO%' then raise; end if; end;
  -- face sobreposta ao contrário: TOP E BOT existe, abre BOT
  perform st_abrir_setup('PMOG13', '9004', 'SMD', '3', 'CP40', 'TOP E BOT', '2690040001');
  begin perform st_abrir_setup('PMOG13', '9004', 'SMD', '3', 'CP40', 'BOT', '2690040001'); raise exception 'FALHOU: face sobreposta reversa';
  exception when others then if sqlerrm not like '%FACE_SOBREPOSTA%' then raise; end if; end;
  -- reabrir OP sem faixa
  r := st_abrir_setup('PMOG13', '9002', 'SMD', '1', 'YSM10', 'TOP', 'X');
  if (r->>'criado')::boolean is not false or (r->>'sem_faixa')::boolean is not true then raise exception 'FALHOU: reabrir sem faixa %', r; end if;
end $t$;

-- 8. PTH: posto × locação, pares, processo e textos dos motivos
do $t$ declare s uuid; r jsonb; begin
  r := st_abrir_setup('PMOG13', '9001', 'PTH', '1', 'A', 'TOP', '2690010001');
  s := (r->>'setup_id')::uuid;
  perform st_incluir_item(s, 'P1', 'L1', 'BAR180-1');
  perform st_incluir_item(s, 'P1', 'L2', 'BAR180-2');
  perform st_incluir_item(s, 'P2', 'L1', 'BAR180-3');
  if (select count(*) from st_setup_itens where setup_id = s) <> 3 then raise exception 'FALHOU: pares PTH'; end if;
  begin perform st_incluir_item(s, 'P1', 'L1', 'BAR180-4'); raise exception 'FALHOU: par PTH repetido';
  exception when others then if sqlerrm not like '%POSICAO_JA_CADASTRADA%' then raise; end if; end;
  begin perform st_incluir_item(s, 'P3', 'L3', 'CAPJ41-99'); raise exception 'FALHOU: SMD no PTH';
  exception when others then if sqlerrm not like '%COMPONENTE_OUTRO_PROCESSO%' then raise; end if; end;
  perform st_liberar_setup(s);
  r := st_trocar_rolo(s, 'P9', 'L1', 'BAR180-1', 'BAR180-5', '2690010010');
  if r->'motivos' <> '["O posto P9 não existe nesse setup."]'::jsonb then raise exception 'FALHOU: posto inexistente %', r; end if;
  r := st_trocar_rolo(s, 'P1', 'L9', 'BAR180-1', 'BAR180-5', '2690010010');
  if r->'motivos' <> '["A locação L9 não existe nesse setup."]'::jsonb then raise exception 'FALHOU: locação inexistente %', r; end if;
  r := st_trocar_rolo(s, 'P2', 'L2', 'BAR180-1', 'BAR180-5', '2690010010');
  if r->'motivos' <> '["A locação L2 não está no posto P2."]'::jsonb then raise exception 'FALHOU: locação em outro posto %', r; end if;
  r := st_trocar_rolo(s, 'P1', 'L1', 'BAR180-9', 'BAR180-5', '2690010010');
  if r->'motivos' <> '["O rolo montado no posto P1 é BAR180-1, não BAR180-9."]'::jsonb then raise exception 'FALHOU: rolo montado PTH %', r; end if;
  r := st_trocar_rolo(s, 'P1', 'L1', 'BAR180-1', 'BAR180-02', '2690010010');
  if r->'motivos' <> '["O rolo BAR180-02 já está montado no posto P1."]'::jsonb then raise exception 'FALHOU: já montado PTH %', r; end if;
  r := st_trocar_rolo(s, 'P1', 'L1', 'BAR180-01', 'BAR180-5', '2690010010');
  if r->>'resultado' <> 'APROVADO' then raise exception 'FALHOU: troca PTH %', r; end if;
end $t$;

-- 9. Permissões: listar ordens e negações sem permissão nenhuma
do $t$ begin
  if (select count(*) from st_listar_ordens()) < 4 then raise exception 'FALHOU: listar ordens'; end if;
end $t$;
select set_config('teste.perms', 'setup.lancar', false);
do $t$ begin
  begin perform * from st_listar_ordens(); raise exception 'FALHOU: listar sem visualizar';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
end $t$;
select set_config('teste.perms', '', false);
do $t$ declare s uuid; begin
  select id into s from st_setups where op = '9002' and face = 'TOP';
  begin perform st_incluir_item(s, '70', 'F70', 'CAPJ41-70'); raise exception 'FALHOU: incluir sem permissão';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
  select id into s from st_setups where op = '9001' and processo = 'SMD';
  begin perform st_trocar_rolo(s, '36', 'ZSY-NOVO', 'CAPJ41-L1R2', 'CAPJ41-L1R9', '2690010010'); raise exception 'FALHOU: trocar sem permissão';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
  begin perform st_abrir_setup('PMOG13', '9004', 'SMD', '1', 'MG5', 'TOP', '2690040001'); raise exception 'FALHOU: abrir sem permissão';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
  begin perform st_importar_estrutura('PMOG13', '[]'); raise exception 'FALHOU: importar sem permissão';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
end $t$;
select set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
select 'TODOS OS TESTES DO SETUP PASSARAM' as resultado;
