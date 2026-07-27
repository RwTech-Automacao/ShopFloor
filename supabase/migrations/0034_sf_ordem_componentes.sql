-- =============================================================
-- ShopFloor Processo — Receita de Integração (BOM por PMO).
-- Tabela sf_ordem_componentes (receita efetiva por OP) + guarda
-- opcional no sf_integrar. Receita vazia = sem restrição.
-- =============================================================

create table public.sf_ordem_componentes (
  ordem_id       uuid not null references public.sf_ordens(id) on delete cascade,
  pmo_componente text not null,
  primary key (ordem_id, pmo_componente)
);
alter table public.sf_ordem_componentes enable row level security;
create policy sf_ordem_componentes_select on public.sf_ordem_componentes
  for select using (tem_permissao('visualizar'));
create policy sf_ordem_componentes_admin on public.sf_ordem_componentes
  for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- sf_integrar: + guarda de receita (mesma assinatura → replace puro) ----------
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
  v_ordem_id  uuid;
  v_receita   text[];
  v_placa_fora text;
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

  -- receita (BOM por PMO): se a OP tem receita, placa de PMO fora dela barra
  select id into v_ordem_id from sf_ordens where pmo = p_pmo and op = p_op limit 1;
  if v_ordem_id is not null then
    select array_agg(lower(trim(pmo_componente))) into v_receita
    from sf_ordem_componentes where ordem_id = v_ordem_id;
    if v_receita is not null and array_length(v_receita, 1) > 0 then
      select x->>'pmo' into v_placa_fora
      from jsonb_array_elements(p_placas) x
      where lower(trim(coalesce(x->>'pmo',''))) <> all (v_receita)
      limit 1;
      if v_placa_fora is not null then
        return jsonb_build_object('ok', false, 'erro', 'PLACA_FORA_DA_RECEITA', 'pmo', v_placa_fora);
      end if;
    end if;
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

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  values (p_colaborador, 'Integração', p_pmo, p_op, p_cliente, p_produto_sn, p_produto_sn_norm, v_codigo);

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  select p_colaborador, 'Integração', coalesce(x->>'pmo',''), coalesce(x->>'op',''), p_cliente,
         x->>'sn', x->>'sn_norm', v_codigo
  from jsonb_array_elements(p_placas) x;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;
