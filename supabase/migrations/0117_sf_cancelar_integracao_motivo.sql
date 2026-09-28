-- =============================================================
-- Cancelar integração: motivo OBRIGATÓRIO.
--
-- Até aqui o cancelamento só gravava quem e quando — no caso da OP 8504 (7 peças, 15 e 18/09/2026)
-- não havia como saber, pelo sistema, por que as integrações foram canceladas. Agora o motivo é
-- obrigatório (como no Cancelar lançamento) e fica em sf_integracoes.cancelada_motivo.
--
-- A função ganha o parâmetro p_motivo → a assinatura antiga (text, text) sai, senão as duas
-- conviveriam e o PostgREST não saberia qual chamar. A regra da 0116 (recusar quando a peça já
-- avançou) continua igual.
-- =============================================================

alter table public.sf_integracoes add column if not exists cancelada_motivo text;

drop function if exists public.sf_cancelar_integracao(text, text);

create or replace function public.sf_cancelar_integracao(
  p_codigo text,
  p_por    text,
  p_motivo text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_id       uuid;
  v_pmo      text;
  v_op       text;
  v_sn_norm  text;
  v_desde    timestamptz;
  v_postos   text;
begin
  if not tem_permissao('shopfloor', 'administrar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    return jsonb_build_object('ok', false, 'erro', 'MOTIVO_OBRIGATORIO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  select id, pmo, op, produto_sn_norm, data_hora
    into v_id, v_pmo, v_op, v_sn_norm, v_desde
  from sf_integracoes where codigo = p_codigo and status = 'ATIVA';
  if v_id is null then
    return jsonb_build_object('ok', false, 'erro', 'NAO_ENCONTRADA');
  end if;

  -- Serializa com o lançamento da mesma OP (nenhum bipe novo entra no meio da checagem).
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);

  -- Início da passagem = o registro de Integração desta integração (cai na data do cabeçalho se não houver).
  select coalesce(min(data_hora), v_desde) into v_desde
  from sf_registros where id_integracao = p_codigo;

  -- Algum lançamento da peça, nesta OP, que não é desta integração e veio depois dela?
  select string_agg(distinct posto, ', ') into v_postos
  from sf_registros
  where pmo = v_pmo and op = v_op and numero_serie_norm = v_sn_norm
    and coalesce(id_integracao, '') <> p_codigo
    and data_hora >= v_desde;
  if v_postos is not null then
    return jsonb_build_object('ok', false, 'erro', 'PECA_AVANCOU', 'postos', v_postos);
  end if;

  update sf_integracoes
  set status = 'CANCELADA', cancelada_em = now(), cancelada_por = coalesce(p_por, ''),
      cancelada_motivo = btrim(p_motivo)
  where id = v_id;

  -- desfaz a "passagem": o gate volta a travar e os SNs ficam livres (histórico fica no HDR + itens)
  delete from sf_registros where id_integracao = p_codigo;

  return jsonb_build_object('ok', true);
end;
$func$;


revoke all on function public.sf_cancelar_integracao(text, text, text) from public, anon;
grant execute on function public.sf_cancelar_integracao(text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
