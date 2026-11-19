-- 0194: EDIÇÃO DE OP COM TRECHOS — a OP inteira (rota, série e faixas de cada trecho, receita, Burn-in e os dados)
-- numa transação só, travada contra o bipe.
--
-- A 0184 deixou a edição presa ao trecho gravado: sf_ordem_regravar_postos devolve cada posto ao trecho que tinha
-- (posto novo vai para a PMO) e sf_ordem_regravar_faixas só regrava as faixas da PMO. A página de edição de OP com
-- trechos (/shopfloor/ordens-nova/[id]) precisa mover posto entre trechos e editar a série (sn_modo) e as faixas das
-- PRTs. sf_ordem_regravar_trechos recebe a OP inteira e grava tudo de uma vez:
--   p_trechos     = [{"seq":1,"postos":["SPI",...],"sn_modo":"proprio","faixas":[{"sn_ini":"A1","sn_fim":"A9"}]}, ...]
--                   com TODOS os trechos (os seqs gravados, cada um uma vez). Código, tipo e OP do Compels de cada
--                   trecho vêm do banco e não mudam. PMO é sempre 'mesmo'; PRT 'mesmo' não tem faixa.
--   p_ordem       = {"cliente","qtd","descricao","acp","status","embalagem_individual","placas_por_painel"} — PMO e
--                   número não entram (OP com trechos não troca). As regras são as do editarOrdemAction: FINALIZADA
--                   grava finalizada_por = 'manual' (outro status limpa); reativar (FINALIZADA -> outro) liga
--                   reaberta_manual (0148) e nunca o desliga; placas por painel não mudam se a OP tem registros.
--   p_componentes = [{"posto","pmo"}] (receita da Integração) e p_burnin = [{"posto","tempo_min"}]: regravados,
--                   só dos postos da rota nova (o app já filtra pelo perfil e põe o 6:00 do posto de Burn-in novo).
--
-- Travas (as mensagens da 0184, que o app já traduz, e as novas): POSTO_REPETIDO, TRECHO_SEM_POSTO, TRECHO_SEM_FAIXA,
-- TRECHOS_DIFERENTES, OP_SEM_TRECHOS (OP antiga: nada é tocado), OP_INEXISTENTE, ALMOXARIFADO_REPETIDO e
-- ALMOXARIFADO_FORA_DO_FIM (posto de recurso 'almoxarifado' — a mesma identificação da tela, sf_postos.perfil ->
-- sf_posto_perfis.recurso — só no fim do trecho da PMO, um só, e o gravado não sai), SN_MODO_INVALIDO, FAIXA_INVALIDA,
-- FAIXA_SOBREPOSTA, CLIENTE_VAZIO, QTD_INVALIDA, PLACAS_INVALIDAS, PLACAS_COM_REGISTROS.
--
-- O HISTÓRICO (o que já andou não muda de dono). O registro não guarda trecho: sf_trecho_enfileirar aponta a PRT no
-- bipe do posto_conclui dela, e sf_trecho_desfazer só estorna se o posto do registro AINDA for o posto_conclui. Então:
--   * POSTO_COM_REGISTROS:<posto> — posto que já tem registro na OP não troca de trecho.
--   * PRT_COM_HISTORICO:<codigo> — PRT com histórico (linha viva na fila do Compels, apontada ou na fila — o que
--     sf_resumo_trechos_op soma — ou registro da OP num posto do trecho) não troca o posto final nem a série.
--   * PRT_FAIXA_COM_HISTORICO:<codigo> — se as faixas de uma PRT com série própria e histórico MUDARAM, as novas
--     ainda têm que cobrir todo SN usado nela. O SN conferido é o CRU (sf_registros.numero_serie e
--     sf_estoque_envios.bipe das entradas), o mesmo que sf_sn_na_faixa compara — nunca o _norm, que perde zeros à
--     esquerda e maiúsculas.
-- A PMO não tem essas recusas (não é apontada pelos triggers; o aviso de SNs fora das faixas dela fica na tela).
--
-- A CORRIDA COM O BIPE. A função pega o mesmo advisory lock do sf_lancar (hashtext(pmo||'/'||op)::bigint, 0031/0163)
-- e DEPOIS a linha da OP com FOR UPDATE — nessa ordem, a mesma do sf_lancar (advisory, e o trigger dele pega a linha),
-- para as duas não se travarem uma à outra. Os triggers sf_trecho_enfileirar/sf_trecho_desfazer (redefinidos aqui)
-- pegam a linha da OP com FOR KEY SHARE antes de ler a rota, o que cobre os bipes que não passam pelo sf_lancar
-- (Burn-in, Integração, Almoxarifado, NQA): KEY SHARE espera o FOR UPDATE da edição, mas não espera outro KEY SHARE
-- (bipe não trava bipe) nem o UPDATE comum da OP (FOR NO KEY UPDATE). Só nas OPs que têm trecho PRT: a OP antiga não
-- paga a trava. sf_ordem_regravar_postos/_faixas (0184) ganham as mesmas duas travas, sem mudar o que fazem.
--
-- Depende de: 0129 (sf_sn_na_faixa), 0145/0148 (finalizada_por, reaberta_manual), 0184.
-- Idempotente (psql -1 -v ON_ERROR_STOP=1 -f). Rollback: docs/operacao/estrutura-op/rollback-0194.sql.

-- ---------- faixa coerente: o mesmo julgamento de faixaCoerente (src/modules/shopfloor/domain/serie.ts) ----------
create or replace function public.sf_faixa_coerente(p_ini text, p_fim text) returns boolean
language plpgsql immutable set search_path = public as $func$
declare
  a text := regexp_replace(coalesce(p_ini, ''), '[^A-Za-z0-9]', '', 'g');
  b text := regexp_replace(coalesce(p_fim, ''), '[^A-Za-z0-9]', '', 'g');
  ma text[]; mb text[];
begin
  if a = '' or b = '' then return false; end if;
  ma := regexp_match(a, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  mb := regexp_match(b, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  if ma is not null and mb is not null then
    return lower(ma[1]) = lower(mb[1]) and lower(ma[3]) = lower(mb[3]) and ma[2]::numeric <= mb[2]::numeric;
  end if;
  if (ma is null) <> (mb is null) then return false; end if; -- uma numérica e a outra não
  return a collate "C" <= b collate "C";
end $func$;
revoke all on function public.sf_faixa_coerente(text, text) from public, anon, authenticated, service_role;

-- ---------- duas faixas se sobrepõem? (faixasSobrepoem do app) ----------
create or replace function public.sf_faixas_sobrepoem(a_ini text, a_fim text, b_ini text, b_fim text) returns boolean
language plpgsql immutable set search_path = public as $func$
declare
  ai text := regexp_replace(coalesce(a_ini, ''), '[^A-Za-z0-9]', '', 'g');
  af text := regexp_replace(coalesce(a_fim, ''), '[^A-Za-z0-9]', '', 'g');
  bi text := regexp_replace(coalesce(b_ini, ''), '[^A-Za-z0-9]', '', 'g');
  bf text := regexp_replace(coalesce(b_fim, ''), '[^A-Za-z0-9]', '', 'g');
  m1 text[]; m2 text[]; m3 text[]; m4 text[];
  num_a boolean; num_b boolean;
begin
  m1 := regexp_match(ai, '^([A-Za-z]*)(\d+)([A-Za-z]*)$'); m2 := regexp_match(af, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  m3 := regexp_match(bi, '^([A-Za-z]*)(\d+)([A-Za-z]*)$'); m4 := regexp_match(bf, '^([A-Za-z]*)(\d+)([A-Za-z]*)$');
  num_a := m1 is not null and m2 is not null;
  num_b := m3 is not null and m4 is not null;
  if num_a and num_b then
    if lower(m1[1]) <> lower(m3[1]) or lower(m1[3]) <> lower(m3[3]) then return false; end if;
    return least(m1[2]::numeric, m2[2]::numeric) <= greatest(m3[2]::numeric, m4[2]::numeric)
       and least(m3[2]::numeric, m4[2]::numeric) <= greatest(m1[2]::numeric, m2[2]::numeric);
  end if;
  if num_a <> num_b then return false; end if;
  return least(ai collate "C", af collate "C") <= greatest(bi collate "C", bf collate "C")
     and least(bi collate "C", bf collate "C") <= greatest(ai collate "C", af collate "C");
end $func$;
revoke all on function public.sf_faixas_sobrepoem(text, text, text, text) from public, anon, authenticated, service_role;

-- ---------- a edição da OP inteira ----------
-- a assinatura de 2 argumentos só existiu em banco local de teste; ela sai para não sobrar uma versão sem as travas
drop function if exists public.sf_ordem_regravar_trechos(uuid, jsonb);
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

-- ---------- os triggers do bipe (0184) com a trava da linha da OP; o resto igual ----------
create or replace function public.sf_trecho_enfileirar()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
begin
  if new.numero_serie_norm = '' or new.status ilike 'reprov%' then
    return new;
  end if;
  -- 0194: a linha da OP em KEY SHARE (só OP com trecho PRT) — espera a edição da OP (FOR UPDATE), não outro bipe
  perform 1 from public.sf_ordens o
   where o.pmo = new.pmo and o.op = new.op
     and exists (select 1 from public.sf_ordem_trechos ot where ot.ordem_id = o.id and ot.tipo = 'prt')
     for key share of o;
  for t in
    select ot.codigo, coalesce(ot.compels_op, '') as op_filha, ot.estoque, o.id as ordem_id
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = new.pmo and o.op = new.op and ot.posto_conclui = new.posto and ot.tipo = 'prt'
  loop
    perform pg_advisory_xact_lock(hashtext(t.ordem_id::text || '/' || t.codigo || '/' || new.numero_serie_norm));
    -- já existe entrada viva (não cancelada e com saldo — na fila ou enviada): reaprovação/rebipe não duplica.
    -- A que já foi estornada por inteiro (enviada ou tocada) não conta: a peça voltou e precisa de entrada nova.
    if exists (select 1 from public.sf_estoque_envios e
                where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = new.posto
                  and e.alvo = new.numero_serie_norm and e.operacao = 'entrada' and e.cancelado_em is null
                  and e.estornado < e.quantidade) then
      continue;
    end if;
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id, criado_em)
    values
      (public.sf_trecho_chave(t.ordem_id, t.codigo, new.posto, new.numero_serie_norm, 'entrada'), 'entrada',
       t.codigo, t.op_filha, new.posto, 'serie', coalesce(nullif(new.numero_serie, ''), new.numero_serie_norm),
       new.numero_serie_norm, greatest(coalesce(new.pecas, 1), 1), t.estoque, t.ordem_id, clock_timestamp());
  end loop;
  return new;
end
$func$;
revoke all on function public.sf_trecho_enfileirar() from public, anon, authenticated;

create or replace function public.sf_trecho_desfazer()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_ent record;
  v_tocada boolean;
begin
  if old.numero_serie_norm = '' or old.status ilike 'reprov%' then
    return old;
  end if;
  -- 0194: a linha da OP em KEY SHARE (só OP com trecho PRT) — espera a edição da OP (FOR UPDATE), não outro bipe
  perform 1 from public.sf_ordens o
   where o.pmo = old.pmo and o.op = old.op
     and exists (select 1 from public.sf_ordem_trechos ot where ot.ordem_id = o.id and ot.tipo = 'prt')
     for key share of o;
  for t in
    select ot.codigo, o.id as ordem_id
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = old.pmo and o.op = old.op and ot.posto_conclui = old.posto and ot.tipo = 'prt'
  loop
    perform pg_advisory_xact_lock(hashtext(t.ordem_id::text || '/' || t.codigo || '/' || old.numero_serie_norm));
    -- outra aprovação da mesma peça no mesmo posto continua valendo: nada a desfazer
    if exists (select 1 from public.sf_registros r
                where r.pmo = old.pmo and r.op = old.op and r.posto = old.posto
                  and r.numero_serie_norm = old.numero_serie_norm and r.id <> old.id
                  and r.status not ilike 'reprov%') then
      continue;
    end if;
    -- a entrada VIGENTE da peça neste trecho (a mais recente ainda viva), travada: a mesma escolha da 0132 (seq_chave)
    select e.* into v_ent
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada'
       and e.cancelado_em is null and e.estornado < e.quantidade
     order by e.seq_chave desc nulls last, e.criado_em desc, e.id desc limit 1
     for update;
    if v_ent.id is null then
      continue;
    end if;
    -- LINHA TOCADA, exatamente como a sf_estoque_reverter (0132): uma rodada já a tentou (o ERP pode ter recebido
    -- com a resposta perdida), uma rodada a está entregando agora (reserva de 15 min) ou ela já teve estorno.
    v_tocada := v_ent.tentativas > 0
                or (v_ent.reservado_em is not null and v_ent.reservado_em >= now() - interval '15 minutes')
                or v_ent.estornado > 0;
    -- ainda na fila e ninguém mexeu → cancela (não se estorna o que não saiu)
    if not v_ent.ok and not v_tocada then
      update public.sf_estoque_envios set cancelado_em = now() where id = v_ent.id;
      continue;
    end if;
    -- enviada, ou tocada → estorno do saldo ligado à entrada (entrada_id) + baixa do saldo, na mesma transação.
    -- Na tocada a entrada segue na fila; a sf_estoque_reservar segura o estorno até ela estar ok.
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id, entrada_id, criado_em)
    values
      (public.sf_trecho_chave(t.ordem_id, v_ent.pmo, v_ent.posto, v_ent.alvo, 'estorno'), 'estorno',
       v_ent.pmo, v_ent.op, v_ent.posto, v_ent.tipo, v_ent.bipe, v_ent.serie_norm,
       v_ent.quantidade - v_ent.estornado, v_ent.estoque, t.ordem_id, v_ent.id, clock_timestamp());
    update public.sf_estoque_envios set estornado = quantidade where id = v_ent.id;
  end loop;
  return old;
end
$func$;
revoke all on function public.sf_trecho_desfazer() from public, anon, authenticated;

-- ---------- as funções de edição da 0184 com as mesmas travas da sf_ordem_regravar_trechos; o resto igual ----------
create or replace function public.sf_ordem_regravar_postos(p_ordem_id uuid, p_postos text[])
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_trava_pmo text;
  v_trava_op text;
  v_pmo_seq int;
  v_antigos jsonb;
  v_vazio text;
  v_rep text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  -- 0194: as travas da edição (advisory da OP, depois a linha), na ordem do sf_lancar; o resto é o da 0184
  select o.pmo, o.op into v_trava_pmo, v_trava_op from sf_ordens o where o.id = p_ordem_id;
  if found then
    perform pg_advisory_xact_lock(hashtext(v_trava_pmo || '/' || v_trava_op)::bigint);
    perform 1 from sf_ordens o where o.id = p_ordem_id for update;
  end if;
  select btrim(pp) into v_rep from unnest(coalesce(p_postos, '{}'::text[])) pp
   group by btrim(pp) having count(*) > 1 order by btrim(pp) limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  select coalesce(jsonb_object_agg(posto, trecho_seq), '{}'::jsonb) into v_antigos
    from sf_ordem_postos where ordem_id = p_ordem_id;
  delete from sf_ordem_postos where ordem_id = p_ordem_id;
  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select p_ordem_id, x.posto, (x.ord - 1)::int, coalesce((v_antigos->>x.posto)::int, v_pmo_seq)
    from unnest(coalesce(p_postos, '{}'::text[])) with ordinality x(posto, ord);
  select ot.codigo into v_vazio from sf_ordem_trechos ot
   where ot.ordem_id = p_ordem_id
     and not exists (select 1 from sf_ordem_postos p where p.ordem_id = ot.ordem_id and p.trecho_seq = ot.seq)
   order by ot.seq limit 1;
  if v_vazio is not null then raise exception 'TRECHO_SEM_POSTO:%', v_vazio; end if;
  update sf_ordem_trechos ot
     set posto_conclui = (select p.posto from sf_ordem_postos p
                           where p.ordem_id = ot.ordem_id and p.trecho_seq = ot.seq order by p.ordem desc limit 1)
   where ot.ordem_id = p_ordem_id;
end
$func$;
revoke all on function public.sf_ordem_regravar_postos(uuid, text[]) from public, anon;
grant execute on function public.sf_ordem_regravar_postos(uuid, text[]) to authenticated, service_role;

create or replace function public.sf_ordem_regravar_faixas(p_ordem_id uuid, p_faixas jsonb)
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_trava_pmo text;
  v_trava_op text;
  v_pmo_seq int;
  v_prt jsonb;
  v_faixas jsonb := case when jsonb_typeof(p_faixas) = 'array' then p_faixas else '[]'::jsonb end;
  v_rep text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  -- 0194: as travas da edição (advisory da OP, depois a linha), na ordem do sf_lancar; o resto é o da 0184
  select o.pmo, o.op into v_trava_pmo, v_trava_op from sf_ordens o where o.id = p_ordem_id;
  if found then
    perform pg_advisory_xact_lock(hashtext(v_trava_pmo || '/' || v_trava_op)::bigint);
    perform 1 from sf_ordens o where o.id = p_ordem_id for update;
  end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  -- OP com trechos: as faixas da PMO = as sem trecho_seq (ou com o da PMO); as de outro trecho não entram.
  -- Sem nenhuma da PMO, ou PRT 'proprio' que ficaria sem faixa: recusa antes de apagar qualquer coisa.
  if v_pmo_seq is not null then
    select coalesce(jsonb_agg(f), '[]'::jsonb) into v_faixas from jsonb_array_elements(v_faixas) f
     where coalesce((f->>'trecho_seq')::int, v_pmo_seq) = v_pmo_seq;
    if jsonb_array_length(v_faixas) = 0 then
      select codigo into v_rep from sf_ordem_trechos where ordem_id = p_ordem_id and seq = v_pmo_seq;
      raise exception 'TRECHO_SEM_FAIXA:%', v_rep;
    end if;
    select ot.codigo into v_rep from sf_ordem_trechos ot
     where ot.ordem_id = p_ordem_id and ot.tipo = 'prt' and ot.sn_modo = 'proprio'
       and not exists (select 1 from sf_ordem_faixas f where f.ordem_id = ot.ordem_id and f.trecho_seq = ot.seq)
     order by ot.seq limit 1;
    if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('sn_ini', f.sn_ini, 'sn_fim', f.sn_fim, 'trecho_seq', f.trecho_seq) order by f.seq), '[]'::jsonb)
    into v_prt
    from sf_ordem_faixas f
   where f.ordem_id = p_ordem_id and f.trecho_seq is not null and f.trecho_seq is distinct from v_pmo_seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, row_number() over (order by z.grupo, z.ord), z.sn_ini, z.sn_fim, z.trecho_seq
    from (
      select 1 as grupo, a.ord, btrim(a.f->>'sn_ini') as sn_ini, btrim(a.f->>'sn_fim') as sn_fim, v_pmo_seq as trecho_seq
        from jsonb_array_elements(v_faixas) with ordinality a(f, ord)
      union all
      select 2, b.ord, b.f->>'sn_ini', b.f->>'sn_fim', (b.f->>'trecho_seq')::int
        from jsonb_array_elements(v_prt) with ordinality b(f, ord)
    ) z;
end
$func$;
revoke all on function public.sf_ordem_regravar_faixas(uuid, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_faixas(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
