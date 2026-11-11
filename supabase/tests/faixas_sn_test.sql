-- Testes da 0181 (faixas de Nº de Série por OP). Roda em Postgres descartável: rodar-faixas-sn-test.sh.
-- Stubs mínimos do Supabase/ShopFloor + as migrações reais do Setup (0111/0112) + a sf_sn_na_faixa
-- da 0129 (extraída do arquivo real pelo runner) + a 0181 aplicada DUAS vezes (idempotência).
create role authenticated; create role anon; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $f$ select nullif(current_setting('teste.uid', true), '')::uuid $f$;
create table public.usuarios (id uuid primary key, nome text not null default '');
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null, op text not null, cliente text not null default '', descricao text not null default '',
  status text not null default '', sn_ini text not null default '', sn_fim text not null default '',
  unique (pmo, op)
);
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  posto text not null default '', pmo text not null, op text not null,
  numero_serie text not null default '', numero_serie_norm text not null default ''
);
create table public.sf_integracoes (
  id uuid primary key default gen_random_uuid(),
  pmo text not null, op text not null, produto_sn text not null, produto_sn_norm text not null,
  status text not null default 'ATIVA'
);
create function public.tem_permissao(m text, p text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',') like '%,' || m || '.' || p || ',%'
$f$;
insert into public.usuarios values ('00000000-0000-0000-0000-000000000001', 'Operador Teste');
select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

-- OPs que existem ANTES da 0181 (o backfill tem que pegar só as com faixa).
insert into public.sf_ordens (pmo, op, sn_ini, sn_fim) values
  ('PMOF01', '8682_F', '0845801001', '0845801993'),
  ('PMOF02', '9100', '', ''),
  ('PMOF03', '9200', 'AB0001', 'AB0100');

\i /tmp/0111.sql
\i /tmp/0112.sql
\i /tmp/sf_sn_na_faixa.sql
\i /tmp/0181.sql
\i /tmp/0181.sql

-- 1. backfill: uma faixa por OP com faixa; reaplicar não duplica
do $t$ begin
  if (select count(*) from sf_ordem_faixas) <> 2 then raise exception 'FALHOU: backfill % linhas', (select count(*) from sf_ordem_faixas); end if;
  if not exists (select 1 from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id
                  where o.op = '8682_F' and f.seq = 1 and f.sn_ini = '0845801001' and f.sn_fim = '0845801993') then
    raise exception 'FALHOU: backfill da 8682_F'; end if;
  if exists (select 1 from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id where o.op = '9100') then
    raise exception 'FALHOU: OP sem faixa ganhou faixa'; end if;
  raise notice '1. backfill: ok';
end $t$;

-- 2. a segunda faixa (o caso real: 7 etiquetas com um dígito a mais)
insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim)
select id, 2, '08458001024', '08458001030' from sf_ordens where op = '8682_F';

do $t$ begin
  if sf_sn_nas_faixas('PMOF01', '8682_F', '0845801500') is not true then raise exception 'FALHOU: faixa 1'; end if;
  if sf_sn_nas_faixas('PMOF01', '8682_F', '08458001027') is not true then raise exception 'FALHOU: faixa 2'; end if;
  if sf_sn_nas_faixas('PMOF01', '8682_F', '08458001031') is not false then raise exception 'FALHOU: fora das duas'; end if;
  if sf_sn_nas_faixas('PMOF02', '9100', '123') is not null then raise exception 'FALHOU: OP sem faixa devia ser null'; end if;
  if sf_sn_nas_faixas('PMOXX', '0000', '123') is not null then raise exception 'FALHOU: OP inexistente devia ser null'; end if;
  if sf_faixas_texto('PMOF01', '8682_F') <> '0845801001 a 0845801993; 08458001024 a 08458001030' then
    raise exception 'FALHOU: texto das faixas: %', sf_faixas_texto('PMOF01', '8682_F'); end if;
  if sf_faixas_texto('PMOF02', '9100') <> ' a ' and sf_faixas_texto('PMOF02', '9100') <> '' then
    raise exception 'FALHOU: texto OP sem faixa: %', sf_faixas_texto('PMOF02', '9100'); end if;
  raise notice '2. sf_sn_nas_faixas / sf_faixas_texto: ok';
end $t$;

-- 3. rede de segurança: OP com sn_ini/sn_fim mas SEM linha na lista (apagada à mão) usa a da OP
do $t$ begin
  delete from sf_ordem_faixas f using sf_ordens o where o.id = f.ordem_id and o.op = '9200';
  if sf_sn_nas_faixas('PMOF03', '9200', 'AB0050') is not true then raise exception 'FALHOU: fallback dentro'; end if;
  if sf_sn_nas_faixas('PMOF03', '9200', 'AB0101') is not false then raise exception 'FALHOU: fallback fora'; end if;
  if sf_faixas_texto('PMOF03', '9200') <> 'AB0001 a AB0100' then raise exception 'FALHOU: fallback texto'; end if;
  raise notice '3. fallback para sn_ini/sn_fim: ok';
end $t$;

-- 4. trigger: gravar sn_ini/sn_fim na OP (app antigo) mantém a faixa 1; as outras ficam
do $t$ declare n int; begin
  insert into sf_ordens (pmo, op, sn_ini, sn_fim) values ('PMOF04', '9300', '5000', '5099');
  if (select count(*) from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id
       where o.op = '9300' and f.seq = 1 and f.sn_ini = '5000' and f.sn_fim = '5099') <> 1 then
    raise exception 'FALHOU: insert não criou a faixa 1'; end if;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim) select id, 2, '6000', '6009' from sf_ordens where op = '9300';
  update sf_ordens set sn_ini = '5001', sn_fim = '5100' where op = '9300';
  select count(*) into n from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id where o.op = '9300';
  if n <> 2 then raise exception 'FALHOU: update mexeu na faixa 2 (% linhas)', n; end if;
  if sf_faixas_texto('PMOF04', '9300') <> '5001 a 5100; 6000 a 6009' then
    raise exception 'FALHOU: update não atualizou a faixa 1: %', sf_faixas_texto('PMOF04', '9300'); end if;
  -- update que NÃO mexe na faixa não toca na lista
  update sf_ordens set cliente = 'X' where op = '9300';
  if sf_faixas_texto('PMOF04', '9300') <> '5001 a 5100; 6000 a 6009' then raise exception 'FALHOU: update de outro campo'; end if;
  -- OP que fica sem faixa perde a lista inteira
  update sf_ordens set sn_ini = '', sn_fim = '' where op = '9300';
  if exists (select 1 from sf_ordem_faixas f join sf_ordens o on o.id = f.ordem_id where o.op = '9300') then
    raise exception 'FALHOU: OP sem faixa manteve a lista'; end if;
  -- excluir a OP leva as faixas (cascade)
  update sf_ordens set sn_ini = '5000', sn_fim = '5099' where op = '9300';
  delete from sf_ordens where op = '9300';
  if exists (select 1 from sf_ordem_faixas f where not exists (select 1 from sf_ordens o where o.id = f.ordem_id)) then
    raise exception 'FALHOU: cascade'; end if;
  raise notice '4. trigger da faixa principal + cascade: ok';
end $t$;

-- 5. aviso da edição: SNs da OP fora das faixas novas
insert into sf_registros (posto, pmo, op, numero_serie, numero_serie_norm) values
  ('SMD',  'PMOF01', '8682_F', '0845801001', '845801001'),
  ('Teste','PMOF01', '8682_F', '0845801001', '845801001'),   -- mesmo SN em outro posto: conta 1
  ('SMD',  'PMOF01', '8682_F', '0845801993', '845801993'),
  ('SMD',  'PMOF01', '8682_F', '08458001024', '8458001024'),
  ('Almoxarifado', 'PMOF01', '8682_F', '', ''),                -- linha sem SN (caixa): não conta
  ('SMD',  'PMOF09', '1', '0845801500', '845801500');         -- outra OP: não conta
insert into sf_integracoes (pmo, op, produto_sn, produto_sn_norm, status) values
  ('PMOF01', '8682_F', '08458001030', '8458001030', 'ATIVA'),
  ('PMOF01', '8682_F', '0845801999', '845801999', 'CANCELADA');  -- cancelada: não conta

do $t$ declare n int; begin
  begin
    perform set_config('teste.perms', 'shopfloor.visualizar', false);
    perform sf_ordem_sns_fora_das_faixas('PMOF01', '8682_F', '[]'::jsonb);
    raise exception 'FALHOU: sem administrar contou';
  exception when others then if sqlerrm not like '%SEM_PERMISSAO%' then raise; end if; end;
  perform set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
  -- as duas faixas: ninguém fora
  n := sf_ordem_sns_fora_das_faixas('PMOF01', '8682_F',
    '[{"sn_ini":"0845801001","sn_fim":"0845801993"},{"sn_ini":"08458001024","sn_fim":"08458001030"}]');
  if n <> 0 then raise exception 'FALHOU: duas faixas, % fora', n; end if;
  -- só a primeira: ficam fora a 024 (registro) e a 030 (integração ativa)
  n := sf_ordem_sns_fora_das_faixas('PMOF01', '8682_F', '[{"sn_ini":"0845801001","sn_fim":"0845801993"}]');
  if n <> 2 then raise exception 'FALHOU: só a faixa 1, % fora (esperado 2)', n; end if;
  -- faixa encolhida: a 993 também sai
  n := sf_ordem_sns_fora_das_faixas('PMOF01', '8682_F', '[{"sn_ini":"0845801001","sn_fim":"0845801992"}]');
  if n <> 3 then raise exception 'FALHOU: faixa encolhida, % fora (esperado 3)', n; end if;
  -- troca de PMO/OP (null): todos os SNs distintos da OP
  n := sf_ordem_sns_fora_das_faixas('PMOF01', '8682_F', null);
  if n <> 4 then raise exception 'FALHOU: null, % (esperado 4)', n; end if;
  -- OP sem registro nenhum
  if sf_ordem_sns_fora_das_faixas('PMOF02', '9100', '[]') <> 0 then raise exception 'FALHOU: OP vazia'; end if;
  raise notice '5. sf_ordem_sns_fora_das_faixas: ok';
end $t$;

-- 6. Setup: liberar e trocar rolo aceitam o SN da SEGUNDA faixa
do $t$ declare s uuid; r jsonb; eq uuid; begin
  perform set_config('teste.perms', 'setup.visualizar,setup.lancar,setup.administrar', false);
  select id into eq from st_equipamentos where processo = 'SMD' and linha = '1' and bloco = 'A' and maquina = 'MG5';
  perform st_importar_estrutura('PMOF01', '[{"componente":"CAPJ41","processo":"SMD"}]');
  perform st_importar_estrutura('PMOF02', '[{"componente":"CAPJ41","processo":"SMD"}]');
  s := (st_abrir_setup('PMOF01', '8682_F', eq, 'TOP')->>'setup_id')::uuid;
  perform st_incluir_item(s, '36', 'ZSY-1', 'CAPJ41-L1R1');
  begin perform st_liberar_setup(s, '08458001031'); raise exception 'FALHOU: liberou fora das faixas';
  exception when others then if sqlerrm not like '%SN_FORA_DA_FAIXA%' then raise; end if; end;
  r := st_liberar_setup(s, '08458001024');
  if (r->>'sem_faixa')::boolean is not false then raise exception 'FALHOU: liberar na faixa 2 %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R1', 'CAPJ41-L1R2', '08458001030');
  if r->>'resultado' <> 'APROVADO' then raise exception 'FALHOU: troca na faixa 2 %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R2', 'CAPJ41-L1R3', '0845801500');
  if r->>'resultado' <> 'APROVADO' then raise exception 'FALHOU: troca na faixa 1 %', r; end if;
  r := st_trocar_rolo(s, '36', 'ZSY-1', 'CAPJ41-L1R3', 'CAPJ41-L1R4', '08458001031');
  if r->>'resultado' <> 'REPROVADO' or (r->'motivos'->>0) not like 'O SN 08458001031 não pertence à faixa da OP.' then
    raise exception 'FALHOU: troca fora das faixas %', r; end if;
  -- OP sem faixa continua sem_faixa
  s := (st_abrir_setup('PMOF02', '9100', eq, 'TOP')->>'setup_id')::uuid;
  perform st_incluir_item(s, '1', 'F1', 'CAPJ41-9001');
  r := st_liberar_setup(s, 'qualquer');
  if (r->>'sem_faixa')::boolean is not true then raise exception 'FALHOU: OP sem faixa %', r; end if;
  raise notice '6. Setup com duas faixas: ok';
end $t$;

-- 7. RLS da tabela: ver com visualizar, escrever só com administrar
grant select on public.sf_ordens to authenticated;
do $t$ declare n int; begin
  perform set_config('teste.perms', 'shopfloor.visualizar', false);
  set local role authenticated;
  select count(*) into n from sf_ordem_faixas;
  if n = 0 then raise exception 'FALHOU: visualizar não vê'; end if;
  begin
    insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim) select id, 9, '1', '2' from sf_ordens where op = '8682_F';
    raise exception 'FALHOU: visualizar escreveu';
  exception when insufficient_privilege then null; end;
  reset role;
  perform set_config('teste.perms', '', false);
  set local role authenticated;
  select count(*) into n from sf_ordem_faixas;
  if n <> 0 then raise exception 'FALHOU: sem permissão viu % linhas', n; end if;
  reset role;
  perform set_config('teste.perms', 'shopfloor.visualizar,shopfloor.administrar', false);
  set local role authenticated;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim) select id, 9, '1', '2' from sf_ordens where op = '8682_F';
  delete from sf_ordem_faixas where seq = 9;
  reset role;
  raise notice '7. RLS: ok';
end $t$;

\echo 'FAIXAS SN SQL OK'
