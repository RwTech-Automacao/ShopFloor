-- =============================================================
-- NQA individual (amostragem para embalagem_individual): a OP não tem caixa física agrupando
-- várias peças — cada peça é seu próprio "pacote". A pessoa do NQA define o lote na hora: bipa
-- peça a peça quais SNs fazem parte daquele lote; a partir da QUANTIDADE bipada, a amostra vem da
-- mesma Tabela NQA usada na caixa. Inspeciona N amostras (Visual/Funcional); todas aprovadas →
-- aprova o lote inteiro; 1 reprovada → reprova o lote inteiro e ele volta pro(s) posto(s)
-- ESCOLHIDO(S) (posto_retorno) — mesma semântica do NQA por caixa (sf_nqa_caixa), só que a
-- membresia do "lote" vem de um array de SNs definido pelo cliente em vez de numero_caixa.
-- =============================================================

create or replace function public.sf_nqa_individual(
  p_pmo           text,
  p_op            text,
  p_posto         text,   -- posto NQA (onde grava)
  p_colaborador   text,
  p_sns_norm      text[], -- SNs (normalizados) que o NQA definiu como o lote
  p_resultado     text,   -- 'Aprovado' | 'Reprovado'
  p_posto_retorno text,   -- posto de retorno (só quando reprovado); '' quando aprovado
  p_amostras      jsonb   -- [{ sn_norm, visual, funcional, observacao }] (as N inspecionadas)
) returns jsonb
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_sn record;
  v_amostra jsonb;
  v_total int;
  v_encontrados int;
  v_cliente text;
  v_amostra_req numeric;
begin
  if not tem_permissao('lancar') then
    raise exception 'SEM_PERMISSAO';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_pmo || '/' || p_op)::bigint);

  v_total := coalesce(array_length(p_sns_norm, 1), 0);
  if v_total = 0 then
    raise exception 'LOTE_VAZIO';
  end if;
  if v_total <> (select count(distinct s) from unnest(p_sns_norm) as s) then
    raise exception 'LOTE_SN_DUPLICADO';
  end if;

  -- Cada SN do lote precisa realmente pertencer à OP (foi lançado nela em algum posto).
  select count(distinct numero_serie_norm), max(cliente) into v_encontrados, v_cliente
  from sf_registros
  where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm);
  if v_encontrados < v_total then
    raise exception 'SN_FORA_DA_OP';
  end if;

  -- Bloqueia se alguma peça do lote está NO NQA agora (último registro = este posto): ou acabou de
  -- ser inspecionada (aprovado=fim / reprovado=aguardando reteste). Depois do reteste, o último
  -- registro vira outro posto → libera a reinspeção num lote novo.
  if exists (
    select 1 from (
      select distinct on (r.numero_serie_norm) r.numero_serie_norm, r.posto
      from sf_registros r
      where r.pmo = p_pmo and r.op = p_op and r.numero_serie_norm = any(p_sns_norm)
      order by r.numero_serie_norm, r.data_hora desc, r.created_at desc
    ) ult
    where ult.posto = p_posto
  ) then
    raise exception 'LOTE_JA_INSPECIONADO';
  end if;

  -- toda amostra tem que ser DESTE lote.
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where not (el.v->>'sn_norm' = any(p_sns_norm))
  ) then
    raise exception 'AMOSTRA_FORA_DO_LOTE';
  end if;

  -- SÓ p/ APROVAR: qtd de amostras >= tamanho da amostra da Tabela NQA (pela qtd do lote).
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

  -- 'Aprovado' não pode ter amostra reprovada.
  if lower(p_resultado) = 'aprovado' and exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'APROVADO_COM_REPROVA';
  end if;

  -- 'Reprovado' exige ao menos uma amostra reprovada (Visual ou Funcional).
  if lower(p_resultado) = 'reprovado' and not exists (
    select 1 from jsonb_array_elements(coalesce(p_amostras, '[]'::jsonb)) as el(v)
    where lower(coalesce(el.v->>'visual', '')) = 'reprovado'
       or lower(coalesce(el.v->>'funcional', '')) = 'reprovado'
  ) then
    raise exception 'REPROVADO_SEM_REPROVA';
  end if;

  -- 1 registro NQA por SN do lote.
  for v_sn in
    select distinct on (numero_serie_norm) numero_serie, numero_serie_norm
    from sf_registros
    where pmo = p_pmo and op = p_op and numero_serie_norm = any(p_sns_norm)
    order by numero_serie_norm, data_hora desc, created_at desc
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

grant execute on function public.sf_nqa_individual(text,text,text,text,text[],text,text,jsonb) to authenticated;

notify pgrst, 'reload schema';
