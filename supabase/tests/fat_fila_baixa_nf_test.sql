-- Testes da fila de prioridade da baixa de NF (migração 0185).
-- Roda num Postgres descartável: supabase/tests/rodar-fat-fila-baixa-nf-test.sh
-- Tudo numa única conexão (as configurações de sessão `teste.perms`/`teste.uid` alimentam os stubs).

-- ---------- stubs mínimos do Supabase ----------
create role anon;
create role authenticated;
create role service_role bypassrls;   -- no Supabase o service_role ignora RLS
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('teste.uid', true), '')::uuid
$f$;

create table public.usuarios (
  id uuid primary key,
  nome text not null default '',
  email text not null default '',
  ativo boolean not null default true
);
insert into public.usuarios (id, nome, email) values
  ('00000000-0000-0000-0000-000000000001', 'Fátima Faturamento', 'fatima@enterplak.com.br'),
  ('00000000-0000-0000-0000-000000000002', '', 'olho@enterplak.com.br');

-- `teste.perms` = lista 'modulo.permissao' separada por vírgula. É a de DOIS argumentos de propósito: a de um
-- argumento anula o RBAC (revisão de segurança de 21/09/2026).
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

\i /tmp/0185.sql

-- Imita os privilégios padrão de tabela do Supabase Dev (tudo liberado pro authenticated/anon), deixando SÓ o
-- RLS como barreira real. Se algum teste de segurança abaixo só passa por causa de um grant estreito, essa
-- linha estoura ele.
grant all on all tables in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;

select set_config('teste.uid', '00000000-0000-0000-0000-000000000001', false);

-- 1. Colocar na fila pela função: posição crescente, nome de quem colocou, e a MESMA nota não entra duas vezes.
do $t$
declare p int;
begin
  perform set_config('teste.perms', 'faturamento.visualizar,faturamento.baixar', false);
  set local role authenticated;
  p := fat_fila_colocar(1001, 80, 'C1 — ACME', 'aguardando', 'ainda sem saldo no estoque PA', 0);
  if p <> 1 then raise exception 'FALHOU: 1ª da fila tinha que ser a posição 1, veio %', p; end if;
  p := fat_fila_colocar(1002, 81, 'C2 — BETA', 'aguardando', 'Compels recusou', 1);
  if p <> 2 then raise exception 'FALHOU: 2ª da fila tinha que ser a posição 2, veio %', p; end if;
  -- de novo a 1001: não duplica, devolve a posição dela
  p := fat_fila_colocar(1001, 80, 'C1 — ACME', 'aguardando', 'outra', 0);
  if p <> 1 then raise exception 'FALHOU: nota já na fila tinha que devolver a posição 1, veio %', p; end if;
  if (select count(*) from fat_fila_baixa_nf where nota_id = 1001) <> 1 then
    raise exception 'FALHOU: a nota entrou duas vezes na fila';
  end if;
  if (select colocado_por_nome from fat_fila_baixa_nf where nota_id = 1001) <> 'Fátima Faturamento' then
    raise exception 'FALHOU: colocado_por_nome errado';
  end if;
  if (select tentativas from fat_fila_baixa_nf where nota_id = 1002) <> 1 then
    raise exception 'FALHOU: tentativas da baixa recusada tinham que ser 1';
  end if;
  -- baixa feita na hora: só registra (finalizada), não é posição de fila
  p := fat_fila_colocar(1003, 82, 'C3', 'baixada', '2 × PMOD44 — ok', 0);
  if p is not null then raise exception 'FALHOU: baixa direta não tem posição, veio %', p; end if;
  if not exists (select 1 from fat_fila_baixa_nf where nota_id = 1003 and status = 'baixada'
                   and finalizado_em is not null and finalizado_por_nome = 'Fátima Faturamento') then
    raise exception 'FALHOU: baixa direta não ficou registrada como finalizada';
  end if;
  begin
    perform fat_fila_colocar(1004, 83, 'C4', 'falhou', '', 0);
    raise exception 'FALHOU: aceitou status que a tela não pode gravar';
  exception when raise_exception then
    if sqlerrm <> 'STATUS_INVALIDO' then raise; end if;
  end;
  reset role;
  raise notice 'colocar na fila: ok';
end $t$;

-- 2. ÍNDICE ÚNICO PARCIAL: uma linha aguardando por nota; a mesma nota pode voltar depois de sair da fila.
do $t$
begin
  begin
    insert into fat_fila_baixa_nf (nota_id, numero) values (1001, 80);
    raise exception 'FALHOU: duas linhas aguardando para a mesma nota';
  exception when unique_violation then null;
  end;
  insert into fat_fila_baixa_nf (nota_id, numero, status, finalizado_em) values (1001, 80, 'removida', now());
  insert into fat_fila_baixa_nf (nota_id, numero, status, finalizado_em) values (1001, 80, 'falhou', now());
  begin
    insert into fat_fila_baixa_nf (nota_id, numero, status) values (1009, 89, 'baixada');
    raise exception 'FALHOU: aceitou finalizada sem finalizado_em';
  exception when check_violation then null;
  end;
  begin
    insert into fat_fila_baixa_nf (nota_id, numero, status) values (1009, 89, 'qualquer');
    raise exception 'FALHOU: aceitou status desconhecido';
  exception when check_violation then null;
  end;
  raise notice 'índice único parcial e checks: ok';
end $t$;

-- 3. RLS: sem faturamento.visualizar não lê nada; com, lê. Sem policy de escrita: insert/update/delete diretos
--    do authenticated não passam (nem com os grants largos do Supabase).
do $t$
declare n int;
begin
  perform set_config('teste.perms', 'shopfloor.visualizar,recebimento.administrar', false);
  set local role authenticated;
  select count(*) into n from fat_fila_baixa_nf;
  if n <> 0 then raise exception 'FALHOU: leu % linhas sem faturamento.visualizar', n; end if;
  perform set_config('teste.perms', 'faturamento.visualizar', false);
  select count(*) into n from fat_fila_baixa_nf;
  if n = 0 then raise exception 'FALHOU: com faturamento.visualizar não leu nada'; end if;

  perform set_config('teste.perms', 'faturamento.visualizar,faturamento.baixar', false);
  begin
    insert into fat_fila_baixa_nf (nota_id, numero) values (2001, 90);
    raise exception 'FALHOU: insert direto do authenticated passou';
  exception when insufficient_privilege then null;
  end;
  update fat_fila_baixa_nf set status = 'baixada', finalizado_em = now() where nota_id = 1001;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: update direto do authenticated mexeu em % linhas', n; end if;
  delete from fat_fila_baixa_nf;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FALHOU: delete direto do authenticated apagou % linhas', n; end if;
  reset role;
  raise notice 'RLS da fila: ok';
end $t$;

-- 4. As funções exigem faturamento.baixar (visualizar não basta); anon nem executa.
do $t$
begin
  perform set_config('teste.perms', 'faturamento.visualizar,shopfloor.administrar,sistema.administrar', false);
  set local role authenticated;
  begin
    perform fat_fila_colocar(3001, 95, 'X', 'aguardando', '', 0);
    raise exception 'FALHOU: colocou na fila sem faturamento.baixar';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  begin
    perform fat_fila_tirar((select id from fat_fila_baixa_nf where nota_id = 1001 and status = 'aguardando'));
    raise exception 'FALHOU: tirou da fila sem faturamento.baixar';
  exception when raise_exception then
    if sqlerrm <> 'SEM_PERMISSAO' then raise; end if;
  end;
  reset role;
  set local role anon;
  begin
    perform fat_fila_tirar(gen_random_uuid());
    raise exception 'FALHOU: anon executou fat_fila_tirar';
  exception when insufficient_privilege then null;
  end;
  reset role;
  raise notice 'permissão das funções: ok';
end $t$;

-- 5. Tirar da fila: aguardando → removida (com quem tirou); a de trás sobe; tirar de novo devolve false.
do $t$
declare v_id uuid; v_ok boolean; p int;
begin
  perform set_config('teste.perms', 'faturamento.visualizar,faturamento.baixar', false);
  select id into v_id from fat_fila_baixa_nf where nota_id = 1001 and status = 'aguardando';
  set local role authenticated;
  v_ok := fat_fila_tirar(v_id);
  if not v_ok then raise exception 'FALHOU: não tirou da fila'; end if;
  if fat_fila_tirar(v_id) then raise exception 'FALHOU: tirar de novo tinha que devolver false'; end if;
  -- a 1002 era a 2ª; agora é a 1ª. A 1001 volta pro FIM (reordenar = tirar e selecionar de novo).
  p := fat_fila_colocar(1002, 81, 'C2 — BETA', 'aguardando', '', 0);
  if p <> 1 then raise exception 'FALHOU: depois de tirar a 1ª, a 2ª tinha que ser a 1, veio %', p; end if;
  p := fat_fila_colocar(1001, 80, 'C1 — ACME', 'aguardando', '', 0);
  if p <> 2 then raise exception 'FALHOU: a nota recolocada tinha que ir pro fim (2), veio %', p; end if;
  reset role;
  if not exists (select 1 from fat_fila_baixa_nf where id = v_id and status = 'removida'
                   and finalizado_por_nome = 'Fátima Faturamento') then
    raise exception 'FALHOU: a linha tirada não ficou removida com quem tirou';
  end if;
  raise notice 'tirar da fila: ok';
end $t$;

-- 6. O cron (service_role) lê e grava direto, ignorando o RLS.
do $t$
declare n int;
begin
  perform set_config('teste.perms', '', false);
  set local role service_role;
  select count(*) into n from fat_fila_baixa_nf where status = 'aguardando';
  if n <> 2 then raise exception 'FALHOU: service_role tinha que ver as 2 aguardando, viu %', n; end if;
  update fat_fila_baixa_nf set tentativas = tentativas + 1, ultima_tentativa_em = now() where nota_id = 1002 and status = 'aguardando';
  update fat_fila_baixa_nf set status = 'baixada_fora', finalizado_em = now() where nota_id = 1002 and status = 'aguardando';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU: service_role não finalizou'; end if;
  reset role;
  raise notice 'cron pela service_role: ok';
end $t$;
