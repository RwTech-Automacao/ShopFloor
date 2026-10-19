-- Testes da soma "já enviado por OP" (migração 0153), sobre a fila da 0132.
-- Roda num Postgres descartável: supabase/tests/rodar-estoque-enviado-test.sh
create role anon;
create role authenticated;
create role service_role bypassrls;
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select false
$f$;

\i /tmp/0132.sql
\i /tmp/0153.sql

-- Entrega (ok) de uma linha de teste: ok e enviado_em andam juntos (check da 0132).
create function public.teste_linha(p_chave text, p_op text, p_qtd int, p_operacao text, p_ok boolean)
returns uuid language plpgsql as $f$
declare v_id uuid;
begin
  insert into public.sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, ok, enviado_em, entrada_id)
  values (p_chave, p_operacao, 'PMOT01', p_op, 'Almoxarifado', 'caixa', 'CX[' || p_chave || '][1]' || p_op || '-PMOT01',
          p_qtd, p_ok, case when p_ok then now() end, null)
  returning id into v_id;
  return v_id;
end
$f$;

-- 1. Sem nenhuma linha entregue a soma é 0 (e não nula).
do $t$
begin
  if public.sf_estoque_enviado('PMOT01', '9100') <> 0 then
    raise exception 'FALHOU: sem linhas a soma tinha que ser 0';
  end if;
end $t$;

-- 2. Só as linhas ok entram: pendente e com erro ficam de fora.
do $t$
declare v numeric;
begin
  perform teste_linha('A1', '9100', 40, 'entrada', true);
  perform teste_linha('A2', '9100', 10, 'entrada', true);
  perform teste_linha('A3', '9100', 99, 'entrada', false);
  v := public.sf_estoque_enviado('PMOT01', '9100');
  if v <> 50 then raise exception 'FALHOU: 40 + 10 entregues (a de 99 pendente não conta), veio %', v; end if;
end $t$;

-- 3. `p_exceto` deixa de fora a própria linha.
do $t$
declare v numeric; v_id uuid;
begin
  select id into v_id from sf_estoque_envios where chave = 'A1';
  v := public.sf_estoque_enviado('PMOT01', '9100', v_id);
  if v <> 10 then raise exception 'FALHOU: sem a linha de 40 sobram 10, veio %', v; end if;
end $t$;

-- 4. É por PMO e OP: outra OP e outra PMO não se misturam.
do $t$
declare v numeric;
begin
  perform teste_linha('B1', '9200', 7, 'entrada', true);
  if public.sf_estoque_enviado('PMOT01', '9200') <> 7 then raise exception 'FALHOU: OP 9200 tinha que ser 7'; end if;
  if public.sf_estoque_enviado('PMOT01', '9100') <> 50 then raise exception 'FALHOU: a OP 9100 mudou com a 9200'; end if;
  if public.sf_estoque_enviado('OUTRA', '9100') <> 0 then raise exception 'FALHOU: outra PMO não deveria somar'; end if;
end $t$;

-- 5. Estorno entregue SUBTRAI (a entrada dele já está ok, como exige a ordem do par).
do $t$
declare v numeric; v_ent uuid;
begin
  select id into v_ent from sf_estoque_envios where chave = 'A2';
  insert into sf_estoque_envios (chave, operacao, pmo, op, posto, tipo, bipe, quantidade, ok, enviado_em, entrada_id)
  values ('A2/S1', 'estorno', 'PMOT01', '9100', 'Almoxarifado', 'caixa', 'CX[A2][1]9100-PMOT01', 4, true, now(), v_ent);
  v := public.sf_estoque_enviado('PMOT01', '9100');
  if v <> 46 then raise exception 'FALHOU: 50 menos o estorno de 4 = 46, veio %', v; end if;
end $t$;

-- 6. Só o servidor chama: authenticated e anon não têm acesso.
do $t$
begin
  begin
    set local role authenticated;
    perform public.sf_estoque_enviado('PMOT01', '9100');
    reset role;
    raise exception 'FALHOU: authenticated conseguiu chamar';
  exception when insufficient_privilege then reset role;
  end;
  begin
    set local role anon;
    perform public.sf_estoque_enviado('PMOT01', '9100');
    reset role;
    raise exception 'FALHOU: anon conseguiu chamar';
  exception when insufficient_privilege then reset role;
  end;
  set local role service_role;
  if public.sf_estoque_enviado('PMOT01', '9100') <> 46 then raise exception 'FALHOU: service_role tinha que ler'; end if;
  reset role;
end $t$;
