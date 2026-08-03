-- =============================================================
-- Embalagem por caixa: estado da caixa (auto-numeração, limite,
-- fechada/última) + fechar (gera código com qtd real e carimba
-- os registros da caixa). Código: CX[seq][qtd]OP-PMO.
-- =============================================================
create table public.sf_caixas (
  id         uuid primary key default gen_random_uuid(),
  pmo        text not null,
  op         text not null,
  posto      text not null,
  seq        int  not null,
  limite     int  not null,
  qtd        int  not null default 0,
  codigo     text not null default '',
  fechada    boolean not null default false,
  ultima     boolean not null default false,
  created_at timestamptz not null default now(),
  fechada_em timestamptz,
  unique (pmo, op, posto, seq)
);
alter table public.sf_caixas enable row level security;
create policy sf_caixas_select on public.sf_caixas for select using (tem_permissao('visualizar'));
create policy sf_caixas_admin  on public.sf_caixas for all using (tem_permissao('lancar')) with check (tem_permissao('lancar'));

-- fechar a caixa: conta as peças (registros com numero_caixa = 'CX['||seq||']'),
-- grava qtd/codigo/fechada/ultima e carimba os registros com o código final.
create or replace function public.sf_fechar_caixa(
  p_pmo text, p_op text, p_posto text, p_seq int, p_ultima boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_marcador text := 'CX[' || p_seq || ']';
  v_qtd      int;
  v_codigo   text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo||'/'||p_op||'/'||p_posto)::bigint);

  select count(*) into v_qtd from sf_registros
  where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador;
  if v_qtd = 0 then
    return jsonb_build_object('ok', false, 'erro', 'CAIXA_VAZIA');
  end if;

  v_codigo := 'CX[' || p_seq || '][' || v_qtd || ']' || p_op || '-' || p_pmo;

  update sf_caixas set qtd = v_qtd, codigo = v_codigo, fechada = true, ultima = p_ultima, fechada_em = now()
  where pmo = p_pmo and op = p_op and posto = p_posto and seq = p_seq;

  update sf_registros set numero_caixa = v_codigo
  where pmo = p_pmo and op = p_op and posto = p_posto and numero_caixa = v_marcador;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;
