-- 0086_sf_lotes.sql
-- Lote entre postos: identidade interna de um painel físico (grupo de SNs lançados juntos).
-- Mapa (pmo, op, SN) -> lote_id. Nunca exposto na UI. Aditiva.

create table if not exists public.sf_lotes (
  pmo               text not null,
  op                text not null,
  numero_serie      text not null,
  numero_serie_norm text not null,
  lote_id           uuid not null,
  criado_em         timestamptz not null default now(),
  primary key (pmo, op, numero_serie_norm)
);
create index if not exists sf_lotes_grupo on public.sf_lotes (pmo, op, lote_id);

alter table public.sf_lotes enable row level security;
-- Leitura: qualquer um que já vê o ShopFloor (operadores precisam ler o lote).
create policy sf_lotes_select on public.sf_lotes for select using (tem_permissao('visualizar'));
-- Escrita: só via sf_criar_lote (security definer). Sem policy de insert/update p/ authenticated.

-- Cria (ou reaproveita) o lote dos SNs enviados juntos. Idempotente e defensiva:
-- - reaproveita um lote_id já existente entre os SNs (nunca sobrescreve mapeamento gravado);
-- - senão gera um novo; insere só o que falta (on conflict do nothing).
-- Recebe SNs já normalizados (p_sns_norm) alinhados 1:1 com os de exibição (p_sns).
create or replace function public.sf_criar_lote(
  p_pmo      text,
  p_op       text,
  p_sns      text[],
  p_sns_norm text[]
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote uuid;
  i int;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  if p_sns_norm is null or array_length(p_sns_norm, 1) is null then
    return null;
  end if;

  if array_length(p_sns, 1) is distinct from array_length(p_sns_norm, 1) then
    raise exception 'SNS_DESALINHADOS';
  end if;

  -- Serializa a criação do lote da MESMA OP (evita 2 "Enviar" simultâneos mintarem lotes diferentes).
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  -- Reaproveita um lote já existente entre esses SNs (nesta OP), se houver.
  select lote_id into v_lote
    from public.sf_lotes
   where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm)
   limit 1;
  if v_lote is null then
    v_lote := gen_random_uuid();
  end if;

  for i in 1 .. array_length(p_sns_norm, 1) loop
    insert into public.sf_lotes (pmo, op, numero_serie, numero_serie_norm, lote_id)
      values (p_pmo, p_op, p_sns[i], p_sns_norm[i], v_lote)
      on conflict (pmo, op, numero_serie_norm) do nothing;
  end loop;

  return v_lote;
end
$$;
