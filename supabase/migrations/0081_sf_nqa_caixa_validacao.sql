-- =============================================================
-- Follow-up do NQA por caixa (achados do code-review): backstop server-side na sf_nqa_caixa.
-- Antes ela confiava 100% no cliente. Agora valida no servidor (defesa contra cliente
-- bugado/estado velho/replay):
--   (a) toda amostra tem que pertencer à caixa;
--   (b) SÓ p/ APROVAR: qtd de amostras >= tamanho da amostra da Tabela NQA (reprovar não exige);
--   (c) resultado 'Aprovado' não pode conter amostra reprovada;
--   (d) resultado 'Reprovado' exige ao menos uma amostra reprovada.
-- Recria a função (create or replace); resto do corpo idêntico à 0080.
-- =============================================================
create or replace function public.sf_nqa_caixa(
  p_pmo           text,
  p_op            text,
  p_posto         text,
  p_colaborador   text,
  p_numero_caixa  text,
  p_resultado     text,
  p_posto_retorno text,
  p_amostras      jsonb
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_sn record;
  v_amostra jsonb;
  v_total int;
  v_cliente text;
  v_amostra_req numeric;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  select count(distinct numero_serie_norm), max(cliente) into v_total, v_cliente
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> '';
  if v_total = 0 then
    raise exception 'CAIXA_VAZIA';
  end if;

  -- (a) toda amostra tem que ser DESTA caixa.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where (el.v->>'sn_norm') not in (
      select numero_serie_norm from sf_registros
      where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
    )
  ) then
    raise exception 'AMOSTRA_FORA_DA_CAIXA';
  end if;

  -- (b) SÓ p/ APROVAR: qtd de amostras >= tamanho da amostra da Tabela NQA (pela qtd da caixa).
  -- Reprovar NÃO exige a amostra completa — 1 amostra reprovada já basta pra reprovar a caixa.
  if lower(p_resultado) = 'aprovado' then
    select tamanho_amostra into v_amostra_req
    from tabela_nqa
    where quantidade_min <= v_total and (quantidade_max is null or v_total <= quantidade_max)
    order by ordem
    limit 1;
    if v_amostra_req is null or v_amostra_req <= 0 then
      raise exception 'AMOSTRA_NQA_INVALIDA';
    end if;
    if coalesce(jsonb_array_length(p_amostras), 0) < v_amostra_req then
      raise exception 'AMOSTRAS_INSUFICIENTES';
    end if;
  end if;

  -- (c) 'Aprovado' não pode ter amostra reprovada.
  if lower(p_resultado) = 'aprovado' and exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'APROVADO_COM_REPROVA';
  end if;

  -- (d) 'Reprovado' exige ao menos uma amostra reprovada (Visual ou Funcional).
  if lower(p_resultado) = 'reprovado' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'REPROVADO_SEM_REPROVA';
  end if;

  -- Bloqueia se a caixa está NO NQA agora (último registro da peça = posto NQA).
  if exists (
    select 1 from (
      select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.posto
      from sf_registros r
      where r.pmo = p_pmo and r.op = p_op
        and r.numero_serie_norm in (
          select numero_serie_norm from sf_registros
          where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
        )
      order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
    ) ult
    where ult.posto = p_posto
  ) then
    raise exception 'CAIXA_JA_INSPECIONADA';
  end if;

  -- 1 registro NQA por SN da caixa.
  for v_sn in
    select distinct numero_serie, numero_serie_norm from sf_registros
    where pmo = p_pmo and op = p_op and numero_caixa = p_numero_caixa and numero_serie_norm <> ''
  loop
    select el.v into v_amostra
    from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where el.v->>'sn_norm' = v_sn.numero_serie_norm
    limit 1;

    insert into sf_registros (colaborador, posto, pmo, op, cliente, status,
      numero_serie, numero_serie_norm, nqa_visual, nqa_funcional, observacao, posto_retorno)
    values (p_colaborador, p_posto, p_pmo, p_op, coalesce(v_cliente, ''), p_resultado,
      v_sn.numero_serie, v_sn.numero_serie_norm,
      coalesce(v_amostra->>'visual', ''), coalesce(v_amostra->>'funcional', ''),
      case when v_amostra is not null then coalesce(v_amostra->>'observacao', '')
           else 'Por amostragem' end,
      nullif(p_posto_retorno, ''));
  end loop;

  return jsonb_build_object('ok', true, 'total', v_total);
end;
$$;

notify pgrst, 'reload schema';
