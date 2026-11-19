-- 0194: EDIÇÃO DE OP COM TRECHOS — a rota, a série e as faixas de CADA trecho numa transação só.
--
-- A 0184 deixou a edição presa ao trecho gravado: sf_ordem_regravar_postos devolve cada posto ao trecho que tinha
-- (posto novo vai para a PMO) e sf_ordem_regravar_faixas só regrava as faixas da PMO. A página de edição de OP com
-- trechos (/shopfloor/ordens-nova/[id]) precisa mover posto entre trechos e editar a série (sn_modo) e as faixas das
-- PRTs. sf_ordem_regravar_trechos recebe a OP inteira por trecho e grava postos + trechos + faixas de uma vez.
--
-- Entrada: p_trechos = [{"seq":1,"postos":["SPI",...],"sn_modo":"proprio","faixas":[{"sn_ini":"A1","sn_fim":"A9"}]}, ...]
-- com TODOS os trechos da OP (os seqs gravados, cada um uma vez). Código, tipo e OP do Compels de cada trecho vêm do
-- banco e não mudam. A PMO é sempre 'mesmo'; PRT 'mesmo' não tem faixa (a lista que vier é ignorada).
--
-- Travas de sempre (as mesmas mensagens da 0184, que o app já traduz): POSTO_REPETIDO, TRECHO_SEM_POSTO,
-- TRECHO_SEM_FAIXA. Novas: TRECHOS_DIFERENTES (a lista não bate com os trechos da OP), OP_SEM_TRECHOS (OP antiga:
-- nada é tocado; ela segue nas funções da 0184), ALMOXARIFADO_FORA_DO_FIM (a rota gravada tem o posto de recurso
-- 'almoxarifado' e ele não ficou por último no trecho da PMO), SN_MODO_INVALIDO, FAIXA_INVALIDA (vazia, formatos
-- diferentes ou início maior que o fim — a regra de faixaCoerente do app) e FAIXA_SOBREPOSTA (entre quaisquer faixas da
-- OP, como no cadastro).
--
-- O HISTÓRICO (o que já andou não pode mudar de dono). O registro (sf_registros) não guarda trecho: o trecho é lido da
-- rota na hora — sf_trecho_enfileirar aponta a PRT no bipe do posto_conclui dela, e sf_trecho_desfazer (cancelar
-- lançamento) só desfaz se o posto do registro AINDA for o posto_conclui da PRT. Então:
--   * POSTO_COM_REGISTROS:<posto> — posto que já tem registro na OP não troca de trecho: as peças já bipadas nele
--     passariam a ser de outra OP do Compels.
--   * PRT_COM_HISTORICO:<codigo> — PRT com histórico (alguma linha viva na fila do Compels, apontada ou na fila — o que
--     sf_resumo_trechos_op soma — ou algum registro da OP num posto do trecho) não troca o posto que conclui (o
--     cancelamento de uma peça já apontada deixaria de estornar, e peças já bipadas no novo posto final nunca seriam
--     apontadas) nem a série (sn_modo).
--   * PRT_FAIXA_COM_HISTORICO:<codigo> — PRT com série própria e histórico só aceita faixa nova que ainda cubra todo SN
--     já usado nela (registro num posto do trecho ou alvo na fila). Ampliar ou acrescentar faixa pode; deixar SN usado
--     de fora, não.
-- A PMO não tem essas recusas: ela não é apontada pelos triggers (segue pelo Almoxarifado) e o aviso de SNs fora das
-- faixas dela continua na tela (sf_ordem_sns_fora_das_faixas, 0181).
--
-- sf_ordem_regravar_postos e sf_ordem_regravar_faixas (0184) ficam como estão: o cadastro antigo ainda as usa.
-- Depende de: 0129 (sf_sn_na_faixa), 0184. Idempotente (psql -1 -v ON_ERROR_STOP=1 -f).
-- Rollback: docs/operacao/estrutura-op/rollback-0194.sql.

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
revoke all on function public.sf_faixa_coerente(text, text) from public, anon, authenticated;

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
revoke all on function public.sf_faixas_sobrepoem(text, text, text, text) from public, anon, authenticated;

-- ---------- a edição por trecho ----------
create or replace function public.sf_ordem_regravar_trechos(p_ordem_id uuid, p_trechos jsonb)
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo text; v_op text;
  v_pmo_seq int;
  v_almox text;
  v_rep text;
  t record;
  v_hist boolean;
  v_entrada jsonb := case when jsonb_typeof(p_trechos) = 'array' then p_trechos else '[]'::jsonb end;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  -- trava a OP: duas edições ao mesmo tempo não se cruzam
  select o.pmo, o.op into v_pmo, v_op from sf_ordens o where o.id = p_ordem_id for update;
  if not found then raise exception 'OP_INEXISTENTE'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  if not exists (select 1 from sf_ordem_trechos where ordem_id = p_ordem_id) then raise exception 'OP_SEM_TRECHOS'; end if;

  -- a entrada, já ligada ao trecho gravado (seq inválido não casa e cai em TRECHOS_DIFERENTES)
  create temporary table if not exists pg_temp.sf_rt_trechos (
    seq int primary key, codigo text, tipo text, sn_modo_antigo text, conclui_antigo text,
    sn_modo text, postos text[], faixas jsonb) on commit drop;
  create temporary table if not exists pg_temp.sf_rt_postos (posto text, seq int, ord int) on commit drop;
  create temporary table if not exists pg_temp.sf_rt_faixas (seq int, ord int, sn_ini text, sn_fim text) on commit drop;
  truncate pg_temp.sf_rt_trechos, pg_temp.sf_rt_postos, pg_temp.sf_rt_faixas;

  if jsonb_array_length(v_entrada) <> (select count(*) from sf_ordem_trechos where ordem_id = p_ordem_id)
     or (select count(distinct x->>'seq') from jsonb_array_elements(v_entrada) x) <> jsonb_array_length(v_entrada)
     or exists (select 1 from jsonb_array_elements(v_entrada) x
                 where not exists (select 1 from sf_ordem_trechos ot
                                    where ot.ordem_id = p_ordem_id and ot.seq::text = x->>'seq')) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;

  insert into pg_temp.sf_rt_trechos
  select ot.seq, ot.codigo, ot.tipo, ot.sn_modo, ot.posto_conclui,
         case when ot.tipo = 'pmo' then 'mesmo' else coalesce(nullif(x->>'sn_modo', ''), ot.sn_modo) end,
         array(select btrim(pp) from jsonb_array_elements_text(
                 case when jsonb_typeof(x->'postos') = 'array' then x->'postos' else '[]'::jsonb end) with ordinality q(pp, o)
                where btrim(pp) <> '' order by o),
         case when jsonb_typeof(x->'faixas') = 'array' then x->'faixas' else '[]'::jsonb end
    from sf_ordem_trechos ot
    join jsonb_array_elements(v_entrada) x on x->>'seq' = ot.seq::text
   where ot.ordem_id = p_ordem_id;

  select codigo into v_rep from pg_temp.sf_rt_trechos where sn_modo not in ('mesmo', 'proprio') order by seq limit 1;
  if v_rep is not null then raise exception 'SN_MODO_INVALIDO:%', v_rep; end if;

  insert into pg_temp.sf_rt_postos
  select p.posto, t2.seq, p.ord::int from pg_temp.sf_rt_trechos t2, unnest(t2.postos) with ordinality p(posto, ord);

  select posto into v_rep from pg_temp.sf_rt_postos group by posto having count(*) > 1 order by posto limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select codigo into v_rep from pg_temp.sf_rt_trechos where cardinality(postos) = 0 order by seq limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_POSTO:%', v_rep; end if;

  -- Almoxarifado: se a rota GRAVADA tem o posto de recurso 'almoxarifado', ele fecha o trecho da PMO
  select p.posto into v_almox
    from sf_ordem_postos p join sf_postos s on s.chave = p.posto join sf_posto_perfis pf on pf.chave = s.perfil
   where p.ordem_id = p_ordem_id and pf.recurso = 'almoxarifado' order by p.ordem limit 1;
  if v_almox is not null
     and (select postos[cardinality(postos)] from pg_temp.sf_rt_trechos where seq = v_pmo_seq) is distinct from v_almox then
    raise exception 'ALMOXARIFADO_FORA_DO_FIM';
  end if;

  -- faixas: as da PMO e as das PRTs com série própria (PRT 'mesmo' não tem faixa)
  insert into pg_temp.sf_rt_faixas
  select t2.seq, f.ord::int, btrim(coalesce(f.f->>'sn_ini', '')), btrim(coalesce(f.f->>'sn_fim', ''))
    from pg_temp.sf_rt_trechos t2, jsonb_array_elements(t2.faixas) with ordinality f(f, ord)
   where t2.tipo = 'pmo' or t2.sn_modo = 'proprio';
  select codigo into v_rep from pg_temp.sf_rt_trechos t2
   where (t2.tipo = 'pmo' or t2.sn_modo = 'proprio') and not exists (select 1 from pg_temp.sf_rt_faixas f where f.seq = t2.seq)
   order by (t2.tipo <> 'pmo'), t2.seq limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
  select t2.codigo into v_rep from pg_temp.sf_rt_faixas f join pg_temp.sf_rt_trechos t2 on t2.seq = f.seq
   where not sf_faixa_coerente(f.sn_ini, f.sn_fim) order by (t2.tipo <> 'pmo'), f.seq, f.ord limit 1;
  if v_rep is not null then raise exception 'FAIXA_INVALIDA:%', v_rep; end if;
  select t2.codigo into v_rep
    from pg_temp.sf_rt_faixas a
    join pg_temp.sf_rt_faixas b on (a.seq <> v_pmo_seq, a.seq, a.ord) < (b.seq <> v_pmo_seq, b.seq, b.ord)
    join pg_temp.sf_rt_trechos t2 on t2.seq = b.seq
   where sf_faixas_sobrepoem(a.sn_ini, a.sn_fim, b.sn_ini, b.sn_fim)
   order by (b.seq <> v_pmo_seq), b.seq, b.ord limit 1;
  if v_rep is not null then raise exception 'FAIXA_SOBREPOSTA:%', v_rep; end if;

  -- histórico 1: posto com registro na OP não troca de trecho
  select np.posto into v_rep
    from pg_temp.sf_rt_postos np
    join sf_ordem_postos op on op.ordem_id = p_ordem_id and op.posto = np.posto
   where coalesce(op.trecho_seq, v_pmo_seq) <> np.seq
     and exists (select 1 from sf_registros r where r.pmo = v_pmo and r.op = v_op and r.posto = np.posto)
   order by np.seq, np.ord limit 1;
  if v_rep is not null then raise exception 'POSTO_COM_REGISTROS:%', v_rep; end if;

  -- histórico 2: PRT com fila/apontamento ou registro não troca o posto final nem a série; faixa só cresce
  for t in select * from pg_temp.sf_rt_trechos where tipo = 'prt' order by seq loop
    v_hist := exists (select 1 from sf_estoque_envios e
                       where e.ordem_id = p_ordem_id and e.pmo = t.codigo and e.cancelado_em is null)
           or exists (select 1 from sf_registros r
                       where r.pmo = v_pmo and r.op = v_op
                         and (r.posto in (select op.posto from sf_ordem_postos op
                                           where op.ordem_id = p_ordem_id and op.trecho_seq = t.seq)
                              or r.posto = any (t.postos)));
    continue when not v_hist;
    if t.postos[cardinality(t.postos)] is distinct from t.conclui_antigo or t.sn_modo <> t.sn_modo_antigo then
      raise exception 'PRT_COM_HISTORICO:%', t.codigo;
    end if;
    if t.sn_modo = 'proprio' and exists (
         with usados as (
           select r.numero_serie as sn from sf_registros r
            where r.pmo = v_pmo and r.op = v_op and r.numero_serie_norm <> ''
              and r.posto in (select op.posto from sf_ordem_postos op where op.ordem_id = p_ordem_id and op.trecho_seq = t.seq)
           union
           select e.alvo from sf_estoque_envios e
            where e.ordem_id = p_ordem_id and e.pmo = t.codigo and e.cancelado_em is null and e.alvo <> ''
         )
         select 1 from usados u
          where not coalesce((select bool_or(sf_sn_na_faixa(f.sn_ini, f.sn_fim, u.sn))
                                from pg_temp.sf_rt_faixas f where f.seq = t.seq), false)) then
      raise exception 'PRT_FAIXA_COM_HISTORICO:%', t.codigo;
    end if;
  end loop;

  -- grava: rota (ordem global na ordem dos trechos), trechos, faixas (PMO primeiro) e a faixa 1 na OP
  delete from sf_ordem_postos where ordem_id = p_ordem_id;
  insert into sf_ordem_postos (ordem_id, posto, ordem, trecho_seq)
  select p_ordem_id, posto, (row_number() over (order by seq, ord) - 1)::int, seq from pg_temp.sf_rt_postos;
  update sf_ordem_trechos ot
     set posto_conclui = t2.postos[cardinality(t2.postos)], sn_modo = t2.sn_modo
    from pg_temp.sf_rt_trechos t2
   where ot.ordem_id = p_ordem_id and ot.seq = t2.seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, row_number() over (order by (f.seq <> v_pmo_seq), f.seq, f.ord), f.sn_ini, f.sn_fim, f.seq
    from pg_temp.sf_rt_faixas f;
  -- o trigger da 0181 reescreve a seq 1 com os mesmos valores (ela é a primeira da PMO): nada se perde
  update sf_ordens o
     set sn_ini = f.sn_ini, sn_fim = f.sn_fim
    from (select sn_ini, sn_fim from pg_temp.sf_rt_faixas where seq = v_pmo_seq order by ord limit 1) f
   where o.id = p_ordem_id;
end
$func$;
revoke all on function public.sf_ordem_regravar_trechos(uuid, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_trechos(uuid, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
