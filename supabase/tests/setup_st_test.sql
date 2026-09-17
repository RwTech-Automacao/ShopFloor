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
end $t$;

-- 2. Estrutura
do $t$ declare r jsonb; begin
  r := st_importar_estrutura('PMOG13', '[{"componente":"capj41","processo":"SMD"},{"componente":"RESR85","processo":"SMD"},{"componente":"BAR180","processo":"PTH"}]');
  if r->>'novos' <> '3' then raise exception 'FALHOU: importar novos %', r; end if;
  r := st_importar_estrutura('PMOG13', '[{"componente":"CAPJ41","processo":"SMD"},{"componente":"BAR180","processo":"SMD"}]');
  if r->>'iguais' <> '1' or r->>'atualizados' <> '1' then raise exception 'FALHOU: reimportar %', r; end if;
  update st_estrutura set processo = 'PTH' where componente = 'BAR180';
  begin perform st_importar_estrutura('PMOX', '[]'); raise exception 'FALHOU: pmo inexistente passou';
  exception when others then if sqlerrm not like '%PMO_INEXISTENTE%' then raise; end if; end;
end $t$;

-- 3. Abrir setup + faixa + face sobreposta
do $t$ declare r jsonb; begin
  r := st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'TOP', '2690010001');
  if (r->>'criado')::boolean is not true then raise exception 'FALHOU: criar %', r; end if;
  r := st_abrir_setup('PMOG13', '9001', 'SMD', '1', 'YSM10', 'top', '2690010001');
  if (r->>'criado')::boolean is not false then raise exception 'FALHOU: reabrir %', r; end if;
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
select 'TODOS OS TESTES DO SETUP PASSARAM' as resultado;
