-- Testes das funções da "foto" da Central do Cliente (migração 0134).
-- Roda num Postgres descartável: supabase/tests/rodar-central-test.sh
-- Confere: (1) só linhas com ACP saem; (2) 'cancelado' fica de fora dos recebimentos;
-- (3) o primeiro registro é a menor data_hora, convertida pra data de São Paulo;
-- (4) cada função devolve um jsonb ÚNICO com a lista inteira (uma foto consistente, sem
--     paginação por offset que poderia ler linhas de momentos diferentes).

-- ---------- stubs mínimos: papéis (o revoke/grant da 0134 referencia estes três) ----------
create role anon;
create role authenticated;
create role service_role;

-- ---------- stubs mínimos das tabelas de origem ----------
create sequence public.processos_numero_seq;
create table public.processos_recebimento (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('public.processos_numero_seq') unique,
  status text not null default 'aberto'
    check (status in ('aberto', 'em_conferencia', 'finalizado', 'cancelado')),
  numero_emb text, acp_cliente text, data_chegada date
);

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  acp text not null default '',
  status text not null default ''
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  pmo text not null default '',
  op text not null default ''
);

\i /tmp/0134.sql

-- ---------- massa de teste: central_recebimentos_para_sincronizar ----------
-- Com ACP, cada status "visível": entram.
insert into public.processos_recebimento (numero_emb, acp_cliente, data_chegada, status) values
  ('EMB001', 'ACP001/26', '2026-10-01', 'aberto'),
  ('EMB002', ' ACP002/26 ', '2026-10-02', 'em_conferencia'),
  ('EMB003', 'ACP003/26', '2026-10-03', 'finalizado');
-- Cancelado: tem que ficar de fora mesmo com ACP preenchida.
insert into public.processos_recebimento (numero_emb, acp_cliente, data_chegada, status) values
  ('EMB004', 'ACP004/26', '2026-10-04', 'cancelado');
-- Sem ACP (vazia ou só espaço): fica de fora mesmo com status visível.
insert into public.processos_recebimento (numero_emb, acp_cliente, data_chegada, status) values
  ('EMB005', '', '2026-10-05', 'aberto'),
  ('EMB006', '   ', '2026-10-06', 'finalizado'),
  ('EMB007', null, '2026-10-07', 'aberto');

do $$
declare v_qtd int; v_foto jsonb;
begin
  -- A função devolve UM jsonb (não um conjunto de linhas): array com a lista inteira.
  select central_recebimentos_para_sincronizar() into v_foto;
  if jsonb_typeof(v_foto) <> 'array' then
    raise exception 'central_recebimentos_para_sincronizar: esperava um array jsonb, veio %', jsonb_typeof(v_foto);
  end if;

  v_qtd := jsonb_array_length(v_foto);
  if v_qtd <> 3 then
    raise exception 'central_recebimentos_para_sincronizar: esperava 3 linhas, veio %', v_qtd;
  end if;

  if exists (select 1 from jsonb_array_elements(v_foto) e where e->>'situacao' = 'cancelado') then
    raise exception 'central_recebimentos_para_sincronizar: uma linha cancelada vazou';
  end if;

  -- acp_cliente aparado (trim) na saída.
  if (select e->>'projetos' from jsonb_array_elements(v_foto) e where e->>'numero_emb' = 'EMB002') <> 'ACP002/26' then
    raise exception 'central_recebimentos_para_sincronizar: acp_cliente não veio aparado';
  end if;
end $$;

-- ---------- massa de teste: central_ordens_para_sincronizar ----------
insert into public.sf_ordens (pmo, op, acp, status) values
  ('PMO1', 'OP1', ' ACP010/26 ', 'FINALIZADA'),
  ('PMO2', 'OP2', 'ACP011/26', 'em_andamento'),
  ('PMO3', 'OP3', '', 'FINALIZADA'),   -- sem ACP: fica de fora
  ('PMO4', 'OP4', 'ACP013/26', 'finalizada');  -- minúsculo: upper() ainda reconhece

-- OP1: dois registros; o menor data_hora em UTC é 2026-10-09 01:30, mas em São Paulo (UTC-3) isso
-- ainda é 2026-10-08 22:30 — prova a conversão de fuso (a data em UTC seria 09, a de SP é 08).
insert into public.sf_registros (pmo, op, data_hora) values
  ('PMO1', 'OP1', '2026-10-09 01:30:00-00'),
  ('PMO1', 'OP1', '2026-10-09 12:00:00-00');
-- OP2: um só registro, virada de fuso pro dia anterior (2026-10-05 01:00 UTC = 2026-10-04 22:00 em SP).
insert into public.sf_registros (pmo, op, data_hora) values
  ('PMO2', 'OP2', '2026-10-05 01:00:00-00');
-- OP4: sem nenhum registro -> primeiro_registro null.

do $$
declare v_qtd int; v_primeiro text; v_concluida text; v_foto jsonb; v_op1 uuid; v_op2 uuid; v_op4 uuid;
begin
  select id into v_op1 from public.sf_ordens where op = 'OP1';
  select id into v_op2 from public.sf_ordens where op = 'OP2';
  select id into v_op4 from public.sf_ordens where op = 'OP4';

  select central_ordens_para_sincronizar() into v_foto;
  if jsonb_typeof(v_foto) <> 'array' then
    raise exception 'central_ordens_para_sincronizar: esperava um array jsonb, veio %', jsonb_typeof(v_foto);
  end if;

  v_qtd := jsonb_array_length(v_foto);
  if v_qtd <> 3 then
    raise exception 'central_ordens_para_sincronizar: esperava 3 linhas (sem ACP fica de fora), veio %', v_qtd;
  end if;

  select e->>'primeiro_registro', e->>'concluida' into v_primeiro, v_concluida
  from jsonb_array_elements(v_foto) e where e->>'id' = v_op1::text;
  if v_primeiro <> '2026-10-08' then
    raise exception 'central_ordens_para_sincronizar: primeiro_registro devia ser 2026-10-08 (fuso SP), veio %', v_primeiro;
  end if;
  if v_concluida <> 'true' then
    raise exception 'central_ordens_para_sincronizar: OP1 devia estar concluida';
  end if;

  select e->>'primeiro_registro' into v_primeiro
  from jsonb_array_elements(v_foto) e where e->>'id' = v_op2::text;
  if v_primeiro <> '2026-10-04' then
    raise exception 'central_ordens_para_sincronizar: primeiro_registro do OP2 devia virar 2026-10-04 no fuso SP, veio %', v_primeiro;
  end if;

  -- acp aparado na saída.
  if (select e->>'projetos' from jsonb_array_elements(v_foto) e where e->>'id' = v_op1::text) <> 'ACP010/26' then
    raise exception 'central_ordens_para_sincronizar: acp não veio aparado';
  end if;

  -- OP4 (ACP preenchida, sem nenhum registro): entra, primeiro_registro null, não finalizada por causa da caixa (minúsculo -> upper reconhece).
  select e->>'primeiro_registro', e->>'concluida' into v_primeiro, v_concluida
  from jsonb_array_elements(v_foto) e where e->>'id' = v_op4::text;
  if v_primeiro is not null then
    raise exception 'central_ordens_para_sincronizar: OP4 sem registros devia ter primeiro_registro null';
  end if;
  if v_concluida <> 'true' then
    raise exception 'central_ordens_para_sincronizar: OP4 (status "finalizada" minúsculo) devia contar como concluída';
  end if;
end $$;

-- ---------- foto vazia: array jsonb vazio, nunca null ----------
do $$
begin
  delete from public.processos_recebimento;
  delete from public.sf_ordens;
  if central_recebimentos_para_sincronizar() <> '[]'::jsonb then
    raise exception 'central_recebimentos_para_sincronizar: sem linhas devia devolver [], veio %', central_recebimentos_para_sincronizar();
  end if;
  if central_ordens_para_sincronizar() <> '[]'::jsonb then
    raise exception 'central_ordens_para_sincronizar: sem linhas devia devolver [], veio %', central_ordens_para_sincronizar();
  end if;
end $$;

select 'central_sincronizacao_test: ok' as resultado;
