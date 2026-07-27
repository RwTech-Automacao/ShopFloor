-- =============================================================
-- ShopFloor Processo — Integração (produto ↔ placas).
-- Cabeçalho + itens + coluna id_integracao em sf_registros +
-- funções atômicas sf_integrar / sf_cancelar_integracao.
-- =============================================================

create table public.sf_integracoes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,               -- INT-aaaammdd-hhmmss-XXXX (exibido)
  data_hora timestamptz not null default now(),
  colaborador text not null default '',
  cliente text not null default '',
  pmo text not null,
  op text not null,
  produto_sn text not null,
  produto_sn_norm text not null,
  qtd_placas int not null default 0,
  status text not null default 'ATIVA',      -- ATIVA | CANCELADA
  cancelada_em timestamptz,
  cancelada_por text,
  created_at timestamptz not null default now()
);
create index sf_integracoes_produto on public.sf_integracoes (produto_sn_norm) where status = 'ATIVA';
alter table public.sf_integracoes enable row level security;
create policy sf_integracoes_select on public.sf_integracoes for select using (tem_permissao('visualizar'));
-- escrita só pelas funções (security definer)

create table public.sf_integracao_itens (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid not null references public.sf_integracoes(id) on delete cascade,
  placa_pmo text not null default '',
  placa_op text not null default '',
  placa_sn text not null,
  placa_sn_norm text not null
);
create index sf_integracao_itens_placa on public.sf_integracao_itens (placa_sn_norm);
alter table public.sf_integracao_itens enable row level security;
create policy sf_integracao_itens_select on public.sf_integracao_itens for select using (tem_permissao('visualizar'));

alter table public.sf_registros add column id_integracao text not null default '';
create index sf_registros_integracao on public.sf_registros (id_integracao) where id_integracao <> '';

-- ---------- registrar (atômica) ----------
create or replace function public.sf_integrar(
  p_colaborador     text,
  p_cliente         text,
  p_pmo             text,
  p_op              text,
  p_produto_sn      text,
  p_produto_sn_norm text,
  p_placas          jsonb   -- [{pmo,op,sn,sn_norm}]
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text;
  v_id     uuid;
  v_placa_dup text;
  v_cod_dup   text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  -- produto já integrado (ATIVA)?
  select codigo into v_codigo
  from sf_integracoes
  where produto_sn_norm = p_produto_sn_norm and status = 'ATIVA'
  limit 1;
  if v_codigo is not null then
    return jsonb_build_object('ok', false, 'erro', 'PRODUTO_JA_INTEGRADO', 'codigo', v_codigo);
  end if;

  -- alguma placa já vinculada a integração ATIVA?
  select i.placa_sn, g.codigo into v_placa_dup, v_cod_dup
  from sf_integracao_itens i
  join sf_integracoes g on g.id = i.integracao_id and g.status = 'ATIVA'
  where i.placa_sn_norm in (select x->>'sn_norm' from jsonb_array_elements(p_placas) x)
  limit 1;
  if v_placa_dup is not null then
    return jsonb_build_object('ok', false, 'erro', 'PLACA_JA_VINCULADA', 'placa', v_placa_dup, 'codigo', v_cod_dup);
  end if;

  v_codigo := 'INT-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
              upper(substr(md5(random()::text), 1, 4));

  insert into sf_integracoes (codigo, colaborador, cliente, pmo, op, produto_sn, produto_sn_norm, qtd_placas)
  values (v_codigo, p_colaborador, p_cliente, p_pmo, p_op, p_produto_sn, p_produto_sn_norm,
          coalesce(jsonb_array_length(p_placas), 0))
  returning id into v_id;

  insert into sf_integracao_itens (integracao_id, placa_pmo, placa_op, placa_sn, placa_sn_norm)
  select v_id, coalesce(x->>'pmo',''), coalesce(x->>'op',''), x->>'sn', x->>'sn_norm'
  from jsonb_array_elements(p_placas) x;

  -- registros posto=Integração: 1 do produto + 1 por placa (alimenta o gate do Lançamento)
  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  values (p_colaborador, 'Integração', p_pmo, p_op, p_cliente, p_produto_sn, p_produto_sn_norm, v_codigo);

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  select p_colaborador, 'Integração', coalesce(x->>'pmo',''), coalesce(x->>'op',''), p_cliente,
         x->>'sn', x->>'sn_norm', v_codigo
  from jsonb_array_elements(p_placas) x;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ---------- cancelar (atômica, admin) ----------
create or replace function public.sf_cancelar_integracao(
  p_codigo text,
  p_por    text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not tem_permissao('administrar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  select id into v_id from sf_integracoes where codigo = p_codigo and status = 'ATIVA';
  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'NAO_ENCONTRADA');
  end if;

  update sf_integracoes
  set status = 'CANCELADA', cancelada_em = now(), cancelada_por = coalesce(p_por, '')
  where id = v_id;

  -- desfaz a "passagem": o gate volta a travar e os SNs ficam livres (histórico fica no HDR + itens)
  delete from sf_registros where id_integracao = p_codigo;

  return jsonb_build_object('ok', true);
end;
$$;
