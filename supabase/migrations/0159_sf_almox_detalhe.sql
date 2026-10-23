-- =============================================================
-- Almoxarifado: o DETALHE de um cartão de pendência (a caixa ou o lote), pra tela abrir o cartão e a pessoa
-- ver o que vai confirmar antes de bipar: os SNs, quem fechou e quando, e o contexto da OP (quantidade,
-- quantas já chegaram ao Almoxarifado, qual é o posto anterior da rota).
--
-- sf_almox_detalhe(p_pmo, p_op, p_codigo, p_lote_id): consulta, sem tabela. Devolve jsonb.
--   sempre: {ok:true, qtd_op, recebidas_op, posto_anterior:{posto, recurso, precisa_aprovado}|null}
--   caixa:  tipo 'caixa', codigo, pecas, sns, fechada_em, fechada_por (colaborador do ÚLTIMO registro da Embalagem)
--   lote:   tipo 'lote', rotulo, pecas, amostra, sns, aprovado_em, ja_lancadas  (a OP individual usa p_lote_id)
--           `amostra` = quantidade a bipar = TODAS as peças do lote (decisão de 21/10; antes era o K da Tabela NQA)
--   peça:   tipo 'peca' (p_codigo = 'AVULSAS', OP individual cujo posto anterior não é NQA): pecas (as que esperam
--           entrada), em (a conclusão mais recente no posto anterior), sns vazio — a entrada é bipe a bipe
--   falha COMO DADO: {ok:false, motivo: op_inexistente | sem_almoxarifado | item_inexistente}
-- Sem permissão é ERRO (SEM_PERMISSAO), nunca resposta vazia.
--
-- REGRA: nenhuma nova. O posto Almoxarifado da rota é escolhido pelo PERFIL, exatamente como na
-- sf_almox_necessidades (0155); o lote vem da sf_almox_lotes (0156); o posto anterior, da
-- sf_almox_posto_anterior (0155). Só leitura.
--
-- Corpo com $func$ (o SQL Editor não aceita dois cifrões). Aditiva e idempotente. Depende da 0155 e 0156.
-- =============================================================
create or replace function public.sf_almox_detalhe(
  p_pmo text, p_op text, p_codigo text, p_lote_id uuid default null
) returns jsonb
language plpgsql stable
security definer
set search_path = public
as $func$
declare
  v_ordem record; v_almox text; v_prev record; v_recebidas int; v_base jsonb;
  v_cx record; v_sns text[]; v_por text; v_lote record; v_pec record;
begin
  if not (tem_permissao('recebimento','lancar') and tem_permissao('shopfloor','visualizar')) then
    raise exception 'SEM_PERMISSAO';
  end if;

  select o.id, o.qtd, coalesce(o.embalagem_individual, false) as individual into v_ordem
    from sf_ordens o where o.pmo = p_pmo and o.op = p_op;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'op_inexistente');
  end if;

  -- O posto Almoxarifado DA ROTA, pelo perfil: o mesmo select da sf_almox_necessidades.
  select opp.posto into v_almox
    from sf_ordem_postos opp
    join sf_postos po       on po.chave = opp.posto
    join sf_posto_perfis pe on pe.chave = po.perfil
   where opp.ordem_id = v_ordem.id and pe.recurso = 'almoxarifado'
   order by opp.ordem, opp.posto
   limit 1;
  if v_almox is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_almoxarifado');
  end if;

  select * into v_prev from sf_almox_posto_anterior(v_ordem.id, v_almox);

  select count(distinct a.numero_serie_norm)::int into v_recebidas
    from sf_registros a
   where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> '';

  v_base := jsonb_build_object('ok', true, 'qtd_op', v_ordem.qtd, 'recebidas_op', v_recebidas,
    'posto_anterior', case when v_prev.posto is null then null
       else jsonb_build_object('posto', v_prev.posto, 'recurso', v_prev.recurso,
                               'precisa_aprovado', v_prev.precisa_aprovado) end);

  -- Peças avulsas: OP individual com posto anterior que não é NQA. Mesma conta da sf_almox_pendencias.
  if v_ordem.individual and p_codigo = 'AVULSAS' and p_lote_id is null
     and v_prev.posto is not null and v_prev.recurso <> 'nqa' then
    with ja as (
      select distinct a.numero_serie_norm as sn
        from sf_registros a
       where a.pmo = p_pmo and a.op = p_op and a.posto = v_almox and a.numero_serie_norm <> ''
    ), esp as (
      select r.numero_serie_norm as sn, max(r.data_hora) as conc
        from sf_registros r
       where r.pmo = p_pmo and r.op = p_op and r.posto = v_prev.posto and r.numero_serie_norm <> ''
         and (not v_prev.precisa_aprovado or lower(r.status) = 'aprovado')
       group by r.numero_serie_norm
    )
    select count(*)::int as n, max(e.conc) as em into v_pec
      from esp e where not exists (select 1 from ja where ja.sn = e.sn);
    if v_pec.n = 0 then
      return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
    end if;
    return v_base || jsonb_build_object('tipo', 'peca', 'pecas', v_pec.n, 'em', v_pec.em,
                                        'sns', '[]'::jsonb);
  end if;

  if v_ordem.individual then
    select l.* into v_lote from sf_almox_lotes(p_pmo, p_op) l where l.lote_id = p_lote_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
    end if;
    return v_base || jsonb_build_object('tipo', 'lote', 'rotulo', v_lote.rotulo, 'pecas', v_lote.pecas,
      'amostra', v_lote.amostra, 'sns', to_jsonb(v_lote.sns), 'aprovado_em', v_lote.aprovado_em,
      'ja_lancadas', v_lote.ja_lancadas);
  end if;

  -- Caixa FECHADA (não revisão), a primeira em (posto, seq) como na entrada.
  select cx.posto, cx.fechada_em into v_cx
    from sf_caixas cx
   where cx.pmo = p_pmo and cx.op = p_op and cx.codigo = p_codigo and cx.fechada and cx.revisao = 0
   order by cx.posto, cx.seq
   limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'item_inexistente');
  end if;

  select array_agg(distinct r.numero_serie_norm order by r.numero_serie_norm) into v_sns
    from sf_registros r
   where r.pmo = p_pmo and r.op = p_op and r.posto = v_cx.posto
     and r.numero_caixa = p_codigo and r.numero_serie_norm <> '';

  select r.colaborador into v_por
    from sf_registros r
   where r.pmo = p_pmo and r.op = p_op and r.posto = v_cx.posto and r.numero_caixa = p_codigo
   order by r.data_hora desc, r.created_at desc
   limit 1;

  return v_base || jsonb_build_object('tipo', 'caixa', 'codigo', p_codigo,
    'pecas', coalesce(cardinality(v_sns), 0), 'sns', to_jsonb(coalesce(v_sns, '{}'::text[])),
    'fechada_em', v_cx.fechada_em, 'fechada_por', nullif(btrim(v_por), ''));
end $func$;

revoke all on function public.sf_almox_detalhe(text, text, text, uuid) from public, anon;
grant execute on function public.sf_almox_detalhe(text, text, text, uuid) to authenticated;

notify pgrst, 'reload schema';
