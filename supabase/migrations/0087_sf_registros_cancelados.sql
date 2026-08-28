-- 0087_sf_registros_cancelados.sql
-- Cancelar lançamento: move um bipe errado pra auditoria e remove de sf_registros.
-- LIFO (só o último bipe do SN), gestor-only, motivo obrigatório. Aditiva.

create table if not exists public.sf_registros_cancelados (
  id                uuid primary key default gen_random_uuid(),
  id_original       uuid not null,
  pmo               text not null,
  op                text not null,
  numero_serie_norm text not null,
  posto             text not null,
  dados             jsonb not null,   -- a linha original inteira (to_jsonb)
  motivo            text not null,
  cancelado_por     uuid,             -- auth.uid()
  cancelado_em      timestamptz not null default now()
);
create index if not exists sf_registros_cancelados_sn
  on public.sf_registros_cancelados (pmo, op, numero_serie_norm);

alter table public.sf_registros_cancelados enable row level security;
create policy sf_registros_cancelados_select
  on public.sf_registros_cancelados for select using (tem_permissao('visualizar'));
-- Escrita só via sf_cancelar_lancamento (security definer). Sem policy de insert/delete.

create or replace function public.sf_cancelar_lancamento(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pmo text; v_op text; v_snnorm text; v_posto text;
  v_recurso text; v_ultimo uuid;
begin
  if not tem_permissao('administrar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'MOTIVO_OBRIGATORIO';
  end if;

  select pmo, op, numero_serie_norm, posto
    into v_pmo, v_op, v_snnorm, v_posto
  from public.sf_registros
  where id = p_id;
  if not found then
    raise exception 'NAO_ENCONTRADO';
  end if;

  -- Serializa com o lançamento da mesma OP (o "último bipe" não muda no meio da checagem).
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  -- Escopo: bloqueia postos com efeito colateral em outra tabela (recurso nulo = permitido).
  select p.recurso into v_recurso
  from public.sf_postos po
  join public.sf_posto_perfis p on p.chave = po.perfil
  where po.chave = v_posto;
  if v_recurso in ('caixa', 'nqa', 'integracao') then
    raise exception 'POSTO_NAO_CANCELAVEL';
  end if;

  -- LIFO: só o bipe mais recente do SN nesta OP.
  select id into v_ultimo
  from public.sf_registros
  where pmo = v_pmo and op = v_op and numero_serie_norm = v_snnorm
  order by data_hora desc, id desc
  limit 1;
  if v_ultimo is distinct from p_id then
    raise exception 'NAO_E_ULTIMO';
  end if;

  -- Move: guarda a linha inteira na auditoria e apaga da tabela viva.
  insert into public.sf_registros_cancelados
    (id_original, pmo, op, numero_serie_norm, posto, dados, motivo, cancelado_por)
  select id, pmo, op, numero_serie_norm, posto, to_jsonb(r), p_motivo, auth.uid()
  from public.sf_registros r
  where id = p_id;

  delete from public.sf_registros where id = p_id;
end
$$;
