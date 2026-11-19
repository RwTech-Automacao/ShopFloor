-- 0195: RECEITA DA INTEGRAÇÃO COM PRT DA ESTRUTURA — a receita de um posto de Integração pode citar uma PRT da própria
-- OP (trecho 'prt' da 0184), e o bipe aceita a placa que já terminou o trecho dela.
-- Spec: docs/superpowers/specs/2026-11-19-receita-integracao-prt-design.md (aprovada em 19/11).
--
-- 1. sf_integrar (a versão vigente é a da 0066): muda SÓ a conferência da receita. Assinatura, permissão, travas,
--    sequência, duplicidade e as gravações ficam idênticas. Cada placa chega como {pmo, op, sn, sn_norm}, com o `pmo` =
--    o item da receita em que o app a encaixou (integracao-panel/resolverPlacaIntegracaoAction). Então:
--    * item da receita que NÃO é PRT da própria OP: a regra de sempre (o pmo da placa está na receita). Cobre a PRT
--      cadastrada como OP separada (ex.: 8683 PRT706), cuja placa leva o código da PRT.
--    * item que É PRT da própria OP (trecho tipo 'prt' da ordem do produto, mesmo código, sem diferenciar maiúsculas):
--      vale SÓ a regra da PRT — a placa tem que ser da própria OP (op da placa = op do produto; outra OP com a mesma
--      PRT é "fora da receita") e ter registro no posto_conclui do trecho na própria PMO/OP: Aprovado se o perfil do
--      posto tem status (sf_posto_perfis.tem_status), qualquer registro se o posto é de passagem. Senão:
--      PLACA_PRT_INCOMPLETA {placa, prt, posto}.
--    * receita vazia aceita qualquer placa; receita sem PRT da própria OP se comporta exatamente como antes.
-- 2. sf_cadastrar_op (0184) e sf_ordem_regravar_trechos (0194): recusam, antes de gravar, um item da receita que é o
--    código de um trecho PRT da OP sem série própria: RECEITA_PRT_INVALIDA:<codigo> (só os itens de postos da rota, os
--    únicos que a função grava). Código que não é trecho da OP segue como PMO, como hoje. O resto das duas funções é o
--    texto da versão vigente.
-- sf_ordem_componentes não muda: pmo_componente passa a poder guardar o código de uma PRT da própria OP.
--
-- ORDEM DE DEPLOY: migração ANTES do app (o app novo manda a placa da PRT com o código dela e traduz o erro novo).
-- Depende de: 0062 (sf_posto_perfis), 0066, 0184, 0194.
-- Idempotente (create or replace). Rollback: docs/operacao/estrutura-op/rollback-0195.sql.

begin;

-- ---------- sf_integrar: o texto da 0066 com a conferência da receita da 0195 (mesma assinatura → replace puro) ----------
create or replace function public.sf_integrar(
  p_colaborador           text,
  p_cliente               text,
  p_pmo                   text,
  p_op                    text,
  p_produto_sn            text,
  p_produto_sn_norm       text,
  p_prev_posto            text,
  p_prev_precisa_aprovado boolean,
  p_placas                jsonb,
  p_posto                 text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo     text;
  v_id         uuid;
  v_placa_dup  text;
  v_cod_dup    text;
  v_ordem_id   uuid;
  v_receita    text[];
  v_placa_fora text;
  v_prev_ok    boolean;
  v_prts       text[];  -- 0195: os itens da receita que são PRT da própria OP (minúsculos)
  v_prt_placa  text;
  v_prt_codigo text;
  v_prt_posto  text;
begin
  if not tem_permissao('lancar') then
    return jsonb_build_object('ok', false, 'erro', 'SEM_PERMISSAO');
  end if;

  perform pg_advisory_xact_lock(hashtext('sf_integracao')::bigint);

  if p_prev_posto <> '' then
    if p_prev_precisa_aprovado then
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_produto_sn_norm
          and posto = p_prev_posto and lower(status) = 'aprovado'
      ) into v_prev_ok;
    else
      select exists(
        select 1 from sf_registros
        where pmo = p_pmo and op = p_op and numero_serie_norm = p_produto_sn_norm
          and posto = p_prev_posto
      ) into v_prev_ok;
    end if;
    if not v_prev_ok then
      return jsonb_build_object('ok', false, 'erro', 'SEQUENCIA', 'posto', p_prev_posto);
    end if;
  end if;

  -- produto já integrado NESTE POSTO (ATIVA)?
  select codigo into v_codigo
  from sf_integracoes
  where produto_sn_norm = p_produto_sn_norm and posto = p_posto and status = 'ATIVA'
  limit 1;
  if v_codigo is not null then
    return jsonb_build_object('ok', false, 'erro', 'PRODUTO_JA_INTEGRADO', 'codigo', v_codigo);
  end if;

  select i.placa_sn, g.codigo into v_placa_dup, v_cod_dup
  from sf_integracao_itens i
  join sf_integracoes g on g.id = i.integracao_id and g.status = 'ATIVA'
  where i.placa_sn_norm in (select x->>'sn_norm' from jsonb_array_elements(p_placas) x)
  limit 1;
  if v_placa_dup is not null then
    return jsonb_build_object('ok', false, 'erro', 'PLACA_JA_VINCULADA', 'placa', v_placa_dup, 'codigo', v_cod_dup);
  end if;

  -- receita (BOM por PMO) DO POSTO que está registrando: placa de PMO fora dela barra
  select id into v_ordem_id from sf_ordens where pmo = p_pmo and op = p_op limit 1;
  if v_ordem_id is not null then
    select array_agg(lower(trim(pmo_componente))) into v_receita
    from sf_ordem_componentes where ordem_id = v_ordem_id and posto = p_posto;
    if v_receita is not null and array_length(v_receita, 1) > 0 then
      -- 0195: item da receita que é trecho PRT da própria OP vale só pela regra da PRT (abaixo)
      select coalesce(array_agg(distinct lower(trim(ot.codigo))), '{}'::text[]) into v_prts
      from sf_ordem_trechos ot
      where ot.ordem_id = v_ordem_id and ot.tipo = 'prt' and lower(trim(ot.codigo)) = any (v_receita);
      -- fora da receita: pmo fora dela, ou PRT da própria OP vinda de outra OP
      select x->>'pmo' into v_placa_fora
      from jsonb_array_elements(p_placas) x
      where lower(trim(coalesce(x->>'pmo',''))) <> all (v_receita)
         or (lower(trim(coalesce(x->>'pmo',''))) = any (v_prts) and btrim(coalesce(x->>'op','')) <> btrim(p_op))
      limit 1;
      if v_placa_fora is not null then
        return jsonb_build_object('ok', false, 'erro', 'PLACA_FORA_DA_RECEITA', 'pmo', v_placa_fora);
      end if;
      -- 0195: a placa da PRT tem que ter terminado o trecho: registro na própria PMO/OP, no posto que conclui o
      -- trecho, Aprovado se o perfil do posto tem status (posto de passagem: basta o registro)
      if cardinality(v_prts) > 0 then
        select x.e->>'sn', ot.codigo, ot.posto_conclui into v_prt_placa, v_prt_codigo, v_prt_posto
        from jsonb_array_elements(p_placas) with ordinality x(e, n)
        cross join lateral (
          select t.codigo, t.posto_conclui from sf_ordem_trechos t
          where t.ordem_id = v_ordem_id and t.tipo = 'prt' and lower(trim(t.codigo)) = lower(trim(coalesce(x.e->>'pmo','')))
          order by t.seq limit 1
        ) ot
        where not exists (
          select 1
          from sf_ordem_trechos t
          join sf_registros r on r.pmo = p_pmo and r.op = p_op and r.posto = t.posto_conclui
                             and r.numero_serie_norm = coalesce(x.e->>'sn_norm','')
          left join sf_postos s on s.chave = t.posto_conclui
          left join sf_posto_perfis pe on pe.chave = s.perfil
          where t.ordem_id = v_ordem_id and t.tipo = 'prt' and lower(trim(t.codigo)) = lower(trim(coalesce(x.e->>'pmo','')))
            and coalesce(x.e->>'sn_norm','') <> ''
            and (not coalesce(pe.tem_status, false) or lower(r.status) = 'aprovado')
        )
        order by x.n
        limit 1;
        if v_prt_codigo is not null then
          return jsonb_build_object('ok', false, 'erro', 'PLACA_PRT_INCOMPLETA',
                                    'placa', v_prt_placa, 'prt', v_prt_codigo, 'posto', v_prt_posto);
        end if;
      end if;
    end if;
  end if;

  v_codigo := 'INT-' || to_char(now(), 'YYYYMMDD-HH24MISS') || '-' ||
              upper(substr(md5(random()::text), 1, 4));

  insert into sf_integracoes (codigo, colaborador, cliente, pmo, op, produto_sn, produto_sn_norm, qtd_placas, posto)
  values (v_codigo, p_colaborador, p_cliente, p_pmo, p_op, p_produto_sn, p_produto_sn_norm,
          coalesce(jsonb_array_length(p_placas), 0), p_posto)
  returning id into v_id;

  insert into sf_integracao_itens (integracao_id, placa_pmo, placa_op, placa_sn, placa_sn_norm)
  select v_id, coalesce(x->>'pmo',''), coalesce(x->>'op',''), x->>'sn', x->>'sn_norm'
  from jsonb_array_elements(p_placas) x;

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  values (p_colaborador, p_posto, p_pmo, p_op, p_cliente, p_produto_sn, p_produto_sn_norm, v_codigo);

  insert into sf_registros (colaborador, posto, pmo, op, cliente, numero_serie, numero_serie_norm, id_integracao)
  select p_colaborador, p_posto, coalesce(x->>'pmo',''), coalesce(x->>'op',''), p_cliente,
         x->>'sn', x->>'sn_norm', v_codigo
  from jsonb_array_elements(p_placas) x;

  return jsonb_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ---------- sf_cadastrar_op: o texto da 0184 com a recusa RECEITA_PRT_INVALIDA ----------
create or replace function public.sf_cadastrar_op(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $func$
declare
  v_id uuid;
  o jsonb := coalesce(p->'ordem', '{}'::jsonb);
  v_trechos jsonb := coalesce(p->'trechos', '[]'::jsonb);
  v_pmo_seq int;
  v_primeira jsonb;
  v_rep text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  if jsonb_typeof(v_trechos) is distinct from 'array' then raise exception 'SEM_TRECHO';
  elsif jsonb_array_length(v_trechos) = 0 then raise exception 'SEM_TRECHO'; end if;
  if (select count(distinct (x->>'seq')::int) from jsonb_array_elements(v_trechos) x) <> jsonb_array_length(v_trechos) then
    raise exception 'TRECHO_SEQ_REPETIDO';
  end if;
  select max((x->>'seq')::int) into v_pmo_seq from jsonb_array_elements(v_trechos) x;
  if (select count(*) from jsonb_array_elements(v_trechos) x where x->>'tipo' = 'pmo') <> 1
     or (select x->>'tipo' from jsonb_array_elements(v_trechos) x where (x->>'seq')::int = v_pmo_seq limit 1) <> 'pmo' then
    raise exception 'PMO_NAO_E_ULTIMO';
  end if;
  select btrim(x->>'codigo') into v_rep from jsonb_array_elements(v_trechos) x
   where jsonb_array_length(coalesce(x->'postos', '[]'::jsonb)) = 0 order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_POSTO:%', v_rep; end if;
  select btrim(pp) into v_rep from jsonb_array_elements(v_trechos) x, jsonb_array_elements_text(x->'postos') pp
   group by btrim(pp) having count(*) > 1 order by btrim(pp) limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select btrim(x->>'codigo') into v_rep from jsonb_array_elements(v_trechos) x
   where (x->>'tipo' = 'pmo' or x->>'sn_modo' = 'proprio') and jsonb_array_length(coalesce(x->'faixas', '[]'::jsonb)) = 0
   order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  -- 0195: PRT da própria OP na receita só com série própria (item de posto da rota: o único que é gravado)
  select btrim(c->>'pmo') into v_rep
    from jsonb_array_elements(coalesce(p->'componentes', '[]'::jsonb)) c
    join jsonb_array_elements(v_trechos) x
      on x->>'tipo' = 'prt' and lower(btrim(x->>'codigo')) = lower(btrim(coalesce(c->>'pmo', '')))
   where coalesce(x->>'sn_modo', 'mesmo') <> 'proprio'
     and exists (select 1 from jsonb_array_elements(v_trechos) y, jsonb_array_elements_text(y->'postos') pp
                  where pp = c->>'posto')
   order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'RECEITA_PRT_INVALIDA:%', v_rep; end if;
  select x->'faixas'->0 into v_primeira from jsonb_array_elements(v_trechos) x where x->>'tipo' = 'pmo';

  insert into sf_ordens (pmo, op, cliente, qtd, descricao, acp, status, sn_ini, sn_fim, embalagem_individual, placas_por_painel)
  values (btrim(o->>'pmo'), btrim(o->>'op'), btrim(coalesce(o->>'cliente', '')), nullif(o->>'qtd', '')::int,
          coalesce(o->>'descricao', ''), coalesce(o->>'acp', ''), 'ATIVA',
          btrim(v_primeira->>'sn_ini'), btrim(v_primeira->>'sn_fim'),
          coalesce((o->>'embalagem_individual')::boolean, false), coalesce((o->>'placas_por_painel')::int, 1))
  returning id into v_id;

  insert into sf_ordem_trechos (ordem_id, seq, codigo, tipo, posto_conclui, sn_modo, estoque, compels_op)
  select v_id, (x->>'seq')::int, btrim(x->>'codigo'), x->>'tipo',
         x->'postos'->>(jsonb_array_length(x->'postos') - 1),
         case when x->>'tipo' = 'pmo' then 'mesmo' else coalesce(x->>'sn_modo', 'mesmo') end,
         case when x->>'tipo' = 'pmo' then 'PA' else 'EINTER' end,
         nullif(btrim(coalesce(x->>'compels_op', '')), '')
    from jsonb_array_elements(v_trechos) x;

  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select v_id, pp.posto, (row_number() over (order by (x->>'seq')::int, pp.ord) - 1)::int, (x->>'seq')::int
    from jsonb_array_elements(v_trechos) x
   cross join lateral jsonb_array_elements_text(x->'postos') with ordinality pp(posto, ord);

  -- o trigger da 0181 já pôs a faixa 1 pelo sn_ini/sn_fim: a lista inteira a substitui (PMO primeiro)
  delete from sf_ordem_faixas where ordem_id = v_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select v_id, row_number() over (order by (x->>'tipo' <> 'pmo'), (x->>'seq')::int, ff.ord),
         btrim(ff.f->>'sn_ini'), btrim(ff.f->>'sn_fim'), (x->>'seq')::int
    from jsonb_array_elements(v_trechos) x
   cross join lateral jsonb_array_elements(
           case when x->>'tipo' = 'pmo' or x->>'sn_modo' = 'proprio' then coalesce(x->'faixas', '[]'::jsonb)
                else '[]'::jsonb end) with ordinality ff(f, ord);

  insert into sf_ordem_componentes (ordem_id, posto, pmo_componente)
  select distinct v_id, c->>'posto', btrim(c->>'pmo')
    from jsonb_array_elements(coalesce(p->'componentes', '[]'::jsonb)) c
   where exists (select 1 from sf_ordem_postos op where op.ordem_id = v_id and op.posto = c->>'posto');
  insert into sf_ordem_burnin (ordem_id, posto, tempo_min)
  select distinct on (b->>'posto') v_id, b->>'posto', (b->>'tempo_min')::int
    from jsonb_array_elements(coalesce(p->'burnin', '[]'::jsonb)) b
   where exists (select 1 from sf_ordem_postos op where op.ordem_id = v_id and op.posto = b->>'posto');
  return v_id;
end
$func$;
revoke all on function public.sf_cadastrar_op(jsonb) from public, anon;
grant execute on function public.sf_cadastrar_op(jsonb) to authenticated, service_role;

-- ---------- sf_ordem_regravar_trechos: o texto da 0194 com a recusa RECEITA_PRT_INVALIDA ----------
create or replace function public.sf_ordem_regravar_trechos(
  p_ordem_id uuid, p_trechos jsonb, p_ordem jsonb, p_componentes jsonb, p_burnin jsonb
) returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo text; v_op text; v_status_antigo text; v_placas_antigo int;
  v_pmo_seq int;
  v_rep text;
  v_n int;
  v_almox text; v_almox_gravado text;
  v_entrada jsonb := case when jsonb_typeof(p_trechos) = 'array' then p_trechos else '[]'::jsonb end;
  v_o jsonb := case when jsonb_typeof(p_ordem) = 'object' then p_ordem else '{}'::jsonb end;
  v_comp jsonb := case when jsonb_typeof(p_componentes) = 'array' then p_componentes else '[]'::jsonb end;
  v_burn jsonb := case when jsonb_typeof(p_burnin) = 'array' then p_burnin else '[]'::jsonb end;
  v_t jsonb;  -- trechos: [{seq, codigo, tipo, sn_modo, sn_modo_antigo, conclui_antigo, postos[], faixas[]}]
  v_p jsonb;  -- rota nova: [{posto, seq, ord}]
  v_f jsonb;  -- faixas novas (PMO e PRT com série própria): [{seq, ord, sn_ini, sn_fim}], PMO primeiro
  v_status text; v_placas int; v_qtd int; v_cliente text;
  t record;
  v_hist boolean;
  v_postos_trecho text[];
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  -- as travas, na ordem do sf_lancar: advisory da OP, depois a linha (o trigger do bipe pega a linha em KEY SHARE)
  select o.pmo, o.op into v_pmo, v_op from sf_ordens o where o.id = p_ordem_id;
  if not found then raise exception 'OP_INEXISTENTE'; end if;
  perform pg_advisory_xact_lock(hashtext(v_pmo || '/' || v_op)::bigint);
  select o.status, o.placas_por_painel into v_status_antigo, v_placas_antigo
    from sf_ordens o where o.id = p_ordem_id and o.pmo = v_pmo and o.op = v_op for update;
  if not found then raise exception 'OP_INEXISTENTE'; end if; -- apagada ou trocada entre a leitura e a trava
  if not exists (select 1 from sf_ordem_trechos where ordem_id = p_ordem_id) then raise exception 'OP_SEM_TRECHOS'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';

  if jsonb_array_length(v_entrada) <> (select count(*) from sf_ordem_trechos where ordem_id = p_ordem_id)
     or (select count(distinct x->>'seq') from jsonb_array_elements(v_entrada) x) <> jsonb_array_length(v_entrada)
     or exists (select 1 from jsonb_array_elements(v_entrada) x
                 where not exists (select 1 from sf_ordem_trechos ot
                                    where ot.ordem_id = p_ordem_id and ot.seq::text = x->>'seq')) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;

  -- a entrada ligada ao trecho gravado
  select coalesce(jsonb_agg(jsonb_build_object(
           'seq', ot.seq, 'codigo', ot.codigo, 'tipo', ot.tipo, 'sn_modo_antigo', ot.sn_modo, 'conclui_antigo', ot.posto_conclui,
           'sn_modo', case when ot.tipo = 'pmo' then 'mesmo' else coalesce(nullif(x->>'sn_modo', ''), ot.sn_modo) end,
           'postos', coalesce((select jsonb_agg(btrim(q.pp) order by q.o)
                                 from jsonb_array_elements_text(case when jsonb_typeof(x->'postos') = 'array' then x->'postos' else '[]'::jsonb end)
                                      with ordinality q(pp, o)
                                where btrim(q.pp) <> ''), '[]'::jsonb),
           'faixas', case when jsonb_typeof(x->'faixas') = 'array' then x->'faixas' else '[]'::jsonb end
         ) order by ot.seq), '[]'::jsonb)
    into v_t
    from sf_ordem_trechos ot join jsonb_array_elements(v_entrada) x on x->>'seq' = ot.seq::text
   where ot.ordem_id = p_ordem_id;

  select t2.codigo into v_rep
    from jsonb_to_recordset(v_t) t2(seq int, codigo text, sn_modo text)
   where t2.sn_modo not in ('mesmo', 'proprio') order by t2.seq limit 1;
  if v_rep is not null then raise exception 'SN_MODO_INVALIDO:%', v_rep; end if;

  select coalesce(jsonb_agg(jsonb_build_object('posto', p.posto, 'seq', t2.seq, 'ord', p.ord) order by t2.seq, p.ord), '[]'::jsonb)
    into v_p
    from jsonb_to_recordset(v_t) t2(seq int, postos jsonb), jsonb_array_elements_text(t2.postos) with ordinality p(posto, ord);

  select p.posto into v_rep from jsonb_to_recordset(v_p) p(posto text) group by p.posto having count(*) > 1 order by p.posto limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select t2.codigo into v_rep from jsonb_to_recordset(v_t) t2(seq int, codigo text, postos jsonb)
   where jsonb_array_length(t2.postos) = 0 order by t2.seq limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_POSTO:%', v_rep; end if;

  -- Almoxarifado: um só, e só no fim do trecho da PMO; o que a rota gravada tinha não sai
  select count(*), min(p.posto) into v_n, v_almox
    from jsonb_to_recordset(v_p) p(posto text) join sf_postos s on s.chave = p.posto join sf_posto_perfis pf on pf.chave = s.perfil
   where pf.recurso = 'almoxarifado';
  if v_n > 1 then raise exception 'ALMOXARIFADO_REPETIDO'; end if;
  select op2.posto into v_almox_gravado
    from sf_ordem_postos op2 join sf_postos s on s.chave = op2.posto join sf_posto_perfis pf on pf.chave = s.perfil
   where op2.ordem_id = p_ordem_id and pf.recurso = 'almoxarifado' order by op2.ordem limit 1;
  if (v_almox is not null or v_almox_gravado is not null)
     and (select t2.postos->>(jsonb_array_length(t2.postos) - 1) from jsonb_to_recordset(v_t) t2(seq int, postos jsonb) where t2.seq = v_pmo_seq)
         is distinct from coalesce(v_almox, v_almox_gravado) then
    raise exception 'ALMOXARIFADO_FORA_DO_FIM';
  end if;

  -- faixas: as da PMO e as das PRTs com série própria (PRT 'mesmo' não tem faixa)
  -- `i` = a posição final (PMO primeiro, depois as PRTs na ordem) = o seq gravado em sf_ordem_faixas
  select coalesce(jsonb_agg(jsonb_build_object('i', z.i, 'seq', z.seq, 'ord', z.ord, 'sn_ini', z.sn_ini, 'sn_fim', z.sn_fim) order by z.i), '[]'::jsonb)
    into v_f
    from (select t2.seq, f.ord, btrim(coalesce(f.f->>'sn_ini', '')) as sn_ini, btrim(coalesce(f.f->>'sn_fim', '')) as sn_fim,
                 row_number() over (order by (t2.seq <> v_pmo_seq), t2.seq, f.ord) as i
            from jsonb_to_recordset(v_t) t2(seq int, tipo text, sn_modo text, faixas jsonb),
                 jsonb_array_elements(t2.faixas) with ordinality f(f, ord)
           where t2.tipo = 'pmo' or t2.sn_modo = 'proprio') z;
  select t2.codigo into v_rep from jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text)
   where (t2.tipo = 'pmo' or t2.sn_modo = 'proprio')
     and not exists (select 1 from jsonb_to_recordset(v_f) f(seq int) where f.seq = t2.seq)
   order by (t2.tipo <> 'pmo'), t2.seq limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  select t2.codigo into v_rep
    from jsonb_to_recordset(v_f) f(i int, seq int, sn_ini text, sn_fim text)
    join jsonb_to_recordset(v_t) t2(seq int, codigo text) on t2.seq = f.seq
   where not sf_faixa_coerente(f.sn_ini, f.sn_fim) order by f.i limit 1;
  if v_rep is not null then raise exception 'FAIXA_INVALIDA:%', v_rep; end if;
  select t2.codigo into v_rep
    from jsonb_to_recordset(v_f) a(i int, sn_ini text, sn_fim text)
    join jsonb_to_recordset(v_f) b(i int, seq int, sn_ini text, sn_fim text) on a.i < b.i
    join jsonb_to_recordset(v_t) t2(seq int, codigo text) on t2.seq = b.seq
   where sf_faixas_sobrepoem(a.sn_ini, a.sn_fim, b.sn_ini, b.sn_fim)
   order by b.i limit 1;
  if v_rep is not null then raise exception 'FAIXA_SOBREPOSTA:%', v_rep; end if;

  -- os dados da OP (as regras do editarOrdemAction)
  v_cliente := btrim(coalesce(v_o->>'cliente', ''));
  if v_cliente = '' then raise exception 'CLIENTE_VAZIO'; end if;
  if coalesce(v_o->>'qtd', '') !~ '^\d{0,9}$' then raise exception 'QTD_INVALIDA'; end if;
  v_qtd := nullif(v_o->>'qtd', '')::int;
  if coalesce(v_o->>'placas_por_painel', '') !~ '^\d{1,9}$' then raise exception 'PLACAS_INVALIDAS'; end if;
  v_placas := (v_o->>'placas_por_painel')::int;
  if v_placas < 1 then raise exception 'PLACAS_INVALIDAS'; end if;
  if v_placas <> v_placas_antigo and exists (select 1 from sf_registros r where r.pmo = v_pmo and r.op = v_op) then
    raise exception 'PLACAS_COM_REGISTROS';
  end if;
  v_status := coalesce(nullif(btrim(v_o->>'status'), ''), 'ATIVA');

  -- histórico 1: posto com registro na OP não troca de trecho
  select np.posto into v_rep
    from jsonb_to_recordset(v_p) np(posto text, seq int, ord int)
    join sf_ordem_postos op2 on op2.ordem_id = p_ordem_id and op2.posto = np.posto
   where coalesce(op2.trecho_seq, v_pmo_seq) <> np.seq
     and exists (select 1 from sf_registros r where r.pmo = v_pmo and r.op = v_op and r.posto = np.posto)
   order by np.seq, np.ord limit 1;
  if v_rep is not null then raise exception 'POSTO_COM_REGISTROS:%', v_rep; end if;

  -- histórico 2: PRT com fila/apontamento ou registro não troca o posto final nem a série; faixa mudada cobre os SNs usados
  for t in
    select t2.* from jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text, sn_modo_antigo text, conclui_antigo text, postos jsonb)
     where t2.tipo = 'prt' order by t2.seq
  loop
    v_postos_trecho := array(select op2.posto from sf_ordem_postos op2 where op2.ordem_id = p_ordem_id and op2.trecho_seq = t.seq)
                    || array(select jsonb_array_elements_text(t.postos));
    v_hist := exists (select 1 from sf_estoque_envios e
                       where e.ordem_id = p_ordem_id and e.pmo = t.codigo and e.cancelado_em is null)
           or exists (select 1 from sf_registros r
                       where r.pmo = v_pmo and r.op = v_op and r.posto = any (v_postos_trecho));
    continue when not v_hist;
    if t.postos->>(jsonb_array_length(t.postos) - 1) is distinct from t.conclui_antigo or t.sn_modo <> t.sn_modo_antigo then
      raise exception 'PRT_COM_HISTORICO:%', t.codigo;
    end if;
    continue when t.sn_modo <> 'proprio';
    -- só quando as faixas desta PRT mudaram
    continue when (select coalesce(jsonb_agg(jsonb_build_object('a', f.sn_ini, 'b', f.sn_fim) order by f.ord), '[]'::jsonb)
                     from jsonb_to_recordset(v_f) f(seq int, ord int, sn_ini text, sn_fim text) where f.seq = t.seq)
                = (select coalesce(jsonb_agg(jsonb_build_object('a', f.sn_ini, 'b', f.sn_fim) order by f.seq), '[]'::jsonb)
                     from sf_ordem_faixas f where f.ordem_id = p_ordem_id and f.trecho_seq = t.seq);
    if exists (
         with usados as (
           -- o SN CRU (com zeros e maiúsculas), o mesmo que sf_sn_na_faixa compara
           select r.numero_serie as sn from sf_registros r
            where r.pmo = v_pmo and r.op = v_op and btrim(r.numero_serie) <> '' and r.posto = any (v_postos_trecho)
           union
           select e.bipe from sf_estoque_envios e
            where e.ordem_id = p_ordem_id and e.pmo = t.codigo and e.operacao = 'entrada' and e.cancelado_em is null
         )
         select 1 from usados u
          where not coalesce((select bool_or(sf_sn_na_faixa(f.sn_ini, f.sn_fim, u.sn))
                                from jsonb_to_recordset(v_f) f(seq int, sn_ini text, sn_fim text) where f.seq = t.seq), false)) then
      raise exception 'PRT_FAIXA_COM_HISTORICO:%', t.codigo;
    end if;
  end loop;

  -- 0195: PRT da própria OP na receita só com série própria (a série NOVA; item de posto da rota nova: o único gravado)
  select btrim(c->>'pmo') into v_rep
    from jsonb_array_elements(v_comp) c
    join jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text)
      on t2.tipo = 'prt' and lower(btrim(t2.codigo)) = lower(btrim(coalesce(c->>'pmo', '')))
   where t2.sn_modo <> 'proprio'
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = c->>'posto')
   order by t2.seq limit 1;
  if v_rep is not null then raise exception 'RECEITA_PRT_INVALIDA:%', v_rep; end if;

  -- grava (nada acima escreveu): rota, trechos, faixas, receita, Burn-in e por último a OP
  delete from sf_ordem_postos where ordem_id = p_ordem_id;
  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select p_ordem_id, p.posto, (row_number() over (order by p.seq, p.ord) - 1)::int, p.seq
    from jsonb_to_recordset(v_p) p(posto text, seq int, ord int);
  update sf_ordem_trechos ot
     set posto_conclui = t2.postos->>(jsonb_array_length(t2.postos) - 1), sn_modo = t2.sn_modo
    from jsonb_to_recordset(v_t) t2(seq int, sn_modo text, postos jsonb)
   where ot.ordem_id = p_ordem_id and ot.seq = t2.seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, f.i, f.sn_ini, f.sn_fim, f.seq
    from jsonb_to_recordset(v_f) f(i int, seq int, sn_ini text, sn_fim text);
  delete from sf_ordem_componentes where ordem_id = p_ordem_id;
  insert into sf_ordem_componentes (ordem_id, posto, pmo_componente)
  select distinct p_ordem_id, c->>'posto', btrim(c->>'pmo')
    from jsonb_array_elements(v_comp) c
   where btrim(coalesce(c->>'pmo', '')) <> ''
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = c->>'posto');
  delete from sf_ordem_burnin where ordem_id = p_ordem_id;
  insert into sf_ordem_burnin (ordem_id, posto, tempo_min)
  select distinct on (b->>'posto') p_ordem_id, b->>'posto', (b->>'tempo_min')::int
    from jsonb_array_elements(v_burn) b
   where (b->>'tempo_min') ~ '^\d{1,9}$' and (b->>'tempo_min')::int > 0
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = b->>'posto');
  -- a faixa 1 da OP é a primeira da PMO: o trigger da 0181 reescreve a seq 1 com os mesmos valores
  update sf_ordens o
     set cliente = v_cliente,
         qtd = v_qtd,
         descricao = btrim(coalesce(v_o->>'descricao', '')),
         acp = btrim(coalesce(v_o->>'acp', '')),
         status = v_status,
         finalizada_por = case when upper(v_status) = 'FINALIZADA' then 'manual' end,
         reaberta_manual = case when upper(btrim(coalesce(v_status_antigo, ''))) = 'FINALIZADA' and upper(v_status) <> 'FINALIZADA'
                                then true else o.reaberta_manual end,
         embalagem_individual = coalesce((v_o->>'embalagem_individual')::boolean, false),
         placas_por_painel = v_placas,
         sn_ini = f.sn_ini, sn_fim = f.sn_fim,
         updated_at = now()
    from (select x.sn_ini, x.sn_fim from jsonb_to_recordset(v_f) x(i int, seq int, sn_ini text, sn_fim text) where x.seq = v_pmo_seq order by x.i limit 1) f
   where o.id = p_ordem_id;
end
$func$;
revoke all on function public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_trechos(uuid, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
