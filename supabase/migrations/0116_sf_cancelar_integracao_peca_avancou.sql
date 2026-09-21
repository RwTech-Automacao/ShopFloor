-- =============================================================
-- Cancelar integração: recusa quando a peça já avançou.
--
-- O cancelamento apaga o registro de Integração da peça (sf_registros.id_integracao = código).
-- Se a peça já tinha passado por outro posto DEPOIS da integração (Embalagem, NQA...), ela ficava
-- embalada/inspecionada sem a etapa anterior — a Grade mostrava "Integração Pendente" numa peça
-- já dentro da caixa (7 peças da OP 8504/PMOC50_ em 15 e 18/09/2026).
--
-- Decisão do usuário (18/09/2026): BLOQUEAR. Para refazer a integração de uma peça que avançou,
-- cancele antes os lançamentos seguintes (Cancelar lançamento, do mais recente pro mais antigo).
--
-- Mesma assinatura → os grants se mantêm.
-- =============================================================

create or replace function public.sf_cancelar_integracao(
  p_codigo text,
  p_por    text
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
  set status = 'CANCELADA', cancelada_em = now(), cancelada_por = coalesce(p_por, '')
  where id = v_id;

  -- desfaz a "passagem": o gate volta a travar e os SNs ficam livres (histórico fica no HDR + itens)
  delete from sf_registros where id_integracao = p_codigo;

  return jsonb_build_object('ok', true);
end;
$func$;

notify pgrst, 'reload schema';
