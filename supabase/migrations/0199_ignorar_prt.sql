-- =============================================================
-- 0199: NOVA OP — IGNORAR UMA PRT. Spec: docs/superpowers/specs/2026-11-26-nova-op-ignorar-prt-design.md
--
-- PRT ignorada = não é trecho. O cadastro (sf_cadastrar_op, 0195) já aceita a cadeia sem uma PRT: ele não confere o
-- espelho do Compels (só seq único, uma PMO e ela com o maior seq) — quem conferia a cadeia inteira era a action, que
-- passa a aceitar a cadeia menos as PRTs ignoradas. Esta migração não muda o cadastro.
--
-- O que muda é a EDIÇÃO (sf_ordem_regravar_trechos, 0194 → 0195 → 0197): ela passa a aceitar INCLUIR DE NOVO uma PRT
-- da cadeia que ficou de fora. Na entrada, a PRT incluída é o item SEM seq, com codigo + compels_op; a ordem da entrada
-- é a ordem nova dos trechos. Só quando há item sem seq roda a sf_ordem_incluir_trechos (nova, interna), que:
--   1. confere a forma e os trechos gravados (todos, uma vez, na mesma ordem entre si) — TRECHOS_DIFERENTES;
--   2. a PMO continua o último — PMO_NAO_E_ULTIMO;
--   3. a PRT incluída desce da OP do Compels do trecho da PMO pelo espelho (sf_compels_ops, pela cadeia de mães, até
--      20 níveis, a mesma regra do trechosDoEspelho) e o código bate — PRT_INCLUIDA_FORA_DA_CADEIA:<codigo>;
--   4. o código ou a OP do Compels dela ainda não é trecho da OP (nem vem duas vezes) — PRT_INCLUIDA_REPETIDA:<codigo>;
--   5. nenhum posto dela tem registro (bipe) nesta OP — PRT_INCLUIDA_COM_REGISTROS:<codigo>;
--   5b. a OP dela no Compels não tem produção apontada (quantidade_produzida = 0) — PRT_INCLUIDA_JA_APONTADA:<codigo>;
--   6. renumera os trechos pela posição na entrada (sf_ordem_trechos.seq e o trecho_seq de sf_ordem_postos e
--      sf_ordem_faixas; o seq do trecho não é gravado em mais lugar nenhum — a fila de PRT liga pelo código), grava a
--      PRT incluída (tipo 'prt', série 'mesmo', estoque EINTER) e devolve a entrada com os seqs novos.
-- Depois disso a regravação segue o texto da 0197 sem mudança (rota, série, faixas, travas do histórico). Uma recusa
-- adiante desfaz a renumeração junto: é tudo uma transação. Sem item sem seq, nada disso roda: a edição de sempre é a
-- mesma, byte a byte de comportamento.
--
-- Apontamento automático (0197): sf_trecho_enfileirar e sf_prt_agrupar só leem sf_ordem_trechos (tipo 'prt'), então a
-- PRT ignorada nunca entra na fila; a incluída de novo entra dali em diante, como qualquer trecho.
--
-- Sem tabela nova (nada de RLS). ORDEM DE DEPLOY: migração ANTES do app. Rollback: docs/operacao/estrutura-op/rollback-0199.sql.
-- Idempotente (psql -1 -v ON_ERROR_STOP=1 -f).

-- ---------- sf_ordem_incluir_trechos: a PRT incluída de novo na edição (só a sf_ordem_regravar_trechos chama) ----------
create or replace function public.sf_ordem_incluir_trechos(p_ordem_id uuid, p_pmo text, p_op text, p_entrada jsonb)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_n int;
  v_pmo_seq int;
  v_pmo_op text;
  v_rep text;
begin
  -- 1. forma: cada item é objeto; seq ausente/nulo/vazio = PRT incluída, senão um número
  if jsonb_typeof(p_entrada) is distinct from 'array'
     or exists (select 1 from jsonb_array_elements(p_entrada) x
                 where jsonb_typeof(x) <> 'object' or (coalesce(x->>'seq', '') <> '' and x->>'seq' !~ '^\d{1,9}$')) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;
  -- os trechos gravados: todos, uma vez cada, e na mesma ordem entre si
  select count(*) into v_n from sf_ordem_trechos where ordem_id = p_ordem_id;
  if (select count(*) from jsonb_array_elements(p_entrada) x where coalesce(x->>'seq', '') <> '') <> v_n
     or (select count(distinct (x->>'seq')::int) from jsonb_array_elements(p_entrada) x where coalesce(x->>'seq', '') <> '') <> v_n
     or exists (select 1 from jsonb_array_elements(p_entrada) x
                 where coalesce(x->>'seq', '') <> ''
                   and not exists (select 1 from sf_ordem_trechos ot where ot.ordem_id = p_ordem_id and ot.seq = (x->>'seq')::int))
     or exists (select 1 from (select row_number() over (order by e.i) as nova, row_number() over (order by (e.x->>'seq')::int) as velha
                                 from jsonb_array_elements(p_entrada) with ordinality e(x, i)
                                where coalesce(e.x->>'seq', '') <> '') z
                 where z.nova <> z.velha) then
    raise exception 'TRECHOS_DIFERENTES';
  end if;
  -- 2. a PMO continua o último trecho
  select ot.seq, btrim(coalesce(ot.compels_op, '')) into v_pmo_seq, v_pmo_op
    from sf_ordem_trechos ot where ot.ordem_id = p_ordem_id and ot.tipo = 'pmo';
  if (select nullif(e.x->>'seq', '')::int from jsonb_array_elements(p_entrada) with ordinality e(x, i) order by e.i desc limit 1)
     is distinct from v_pmo_seq then
    raise exception 'PMO_NAO_E_ULTIMO';
  end if;
  -- 3. a PRT incluída é da cadeia do Compels desta OP: desce da OP da PMO pelo espelho, com o mesmo código
  select coalesce(nullif(btrim(coalesce(x->>'codigo', '')), ''), '?') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(x->>'seq', '') = ''
     and case
           when coalesce(x->>'compels_op', '') !~ '^\s*\d{1,9}\s*$' or v_pmo_op !~ '^\d{1,9}$' then true
           when btrim(x->>'compels_op') = v_pmo_op then true
           else not exists (
             with recursive sobe(numero, mae, n) as (
               select c.numero, c.mae_numero, 0 from sf_compels_ops c
                where c.numero = btrim(x->>'compels_op')::int
                  and lower(btrim(c.codigo)) = lower(btrim(coalesce(x->>'codigo', '')))
               union all
               select c.numero, c.mae_numero, s.n + 1 from sobe s join sf_compels_ops c on c.numero = s.mae where s.n < 20
             )
             select 1 from sobe where sobe.mae = v_pmo_op::int)
         end
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_FORA_DA_CADEIA:%', v_rep; end if;
  -- 4. ainda fora da OP: nem o código nem a OP do Compels já são trecho dela, e não vem duas vezes
  select btrim(x->>'codigo') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(x->>'seq', '') = ''
     and (exists (select 1 from sf_ordem_trechos ot
                   where ot.ordem_id = p_ordem_id
                     and (lower(btrim(ot.codigo)) = lower(btrim(x->>'codigo'))
                          or btrim(coalesce(ot.compels_op, '')) = btrim(x->>'compels_op')))
          or exists (select 1 from jsonb_array_elements(p_entrada) with ordinality f(y, j)
                      where f.j <> e.i and coalesce(y->>'seq', '') = ''
                        and (lower(btrim(y->>'codigo')) = lower(btrim(x->>'codigo'))
                             or btrim(y->>'compels_op') = btrim(x->>'compels_op'))))
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_REPETIDA:%', v_rep; end if;
  -- 5. sem bipe: nenhum posto da PRT incluída tem registro nesta OP
  select btrim(x->>'codigo') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i),
         jsonb_array_elements_text(case when jsonb_typeof(x->'postos') = 'array' then x->'postos' else '[]'::jsonb end) pp
   where coalesce(x->>'seq', '') = ''
     and exists (select 1 from sf_registros r where r.pmo = p_pmo and r.op = p_op and r.posto = btrim(pp))
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_COM_REGISTROS:%', v_rep; end if;

  -- 5b. sem apontamento à mão no Compels: se a OP da PRT já tem produção apontada, incluí-la de novo apontaria em dobro
  select btrim(x->>'codigo') into v_rep
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(x->>'seq', '') = ''
     and exists (select 1 from sf_compels_ops c where c.numero = btrim(x->>'compels_op')::int and c.quantidade_produzida > 0)
   order by i limit 1;
  if v_rep is not null then raise exception 'PRT_INCLUIDA_JA_APONTADA:%', v_rep; end if;

  -- 6. renumera pela posição na entrada (em dois passos: a PK (ordem_id, seq) não aceita troca no meio) e grava a PRT
  update sf_ordem_trechos set seq = seq + 100000 where ordem_id = p_ordem_id;
  update sf_ordem_trechos ot set seq = m.nova
    from (select (e.x->>'seq')::int as velha, e.i::int as nova
            from jsonb_array_elements(p_entrada) with ordinality e(x, i) where coalesce(e.x->>'seq', '') <> '') m
   where ot.ordem_id = p_ordem_id and ot.seq = m.velha + 100000;
  update sf_ordem_postos op2 set trecho_seq = m.nova
    from (select (e.x->>'seq')::int as velha, e.i::int as nova
            from jsonb_array_elements(p_entrada) with ordinality e(x, i) where coalesce(e.x->>'seq', '') <> '') m
   where op2.ordem_id = p_ordem_id and op2.trecho_seq = m.velha;
  update sf_ordem_faixas f set trecho_seq = m.nova
    from (select (e.x->>'seq')::int as velha, e.i::int as nova
            from jsonb_array_elements(p_entrada) with ordinality e(x, i) where coalesce(e.x->>'seq', '') <> '') m
   where f.ordem_id = p_ordem_id and f.trecho_seq = m.velha;
  -- posto_conclui fica vazio só até a regravação, logo adiante na mesma transação, gravar o último posto do trecho
  -- o código gravado é o OFICIAL do espelho (a grafia do Compels), não o que o cliente mandou
  insert into sf_ordem_trechos (ordem_id, seq, codigo, tipo, posto_conclui, sn_modo, estoque, compels_op)
  select p_ordem_id, e.i::int, coalesce((select btrim(c.codigo) from sf_compels_ops c where c.numero = btrim(e.x->>'compels_op')::int), btrim(e.x->>'codigo')),
         'prt', '', 'mesmo', 'EINTER', btrim(e.x->>'compels_op')
    from jsonb_array_elements(p_entrada) with ordinality e(x, i)
   where coalesce(e.x->>'seq', '') = '';
  return (select jsonb_agg(e.x || jsonb_build_object('seq', e.i) order by e.i)
            from jsonb_array_elements(p_entrada) with ordinality e(x, i));
end
$func$;
revoke all on function public.sf_ordem_incluir_trechos(uuid, text, text, jsonb) from public, anon, authenticated, service_role;

-- ---------- sf_ordem_regravar_trechos: o texto da 0197 + a PRT incluída de novo (item sem seq) ----------
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
  -- 0199: PRT INCLUÍDA DE NOVO (item sem seq): entra e os trechos são renumerados pela ordem da entrada ANTES de tudo
  -- abaixo, que segue igual (uma recusa adiante desfaz a renumeração junto)
  if exists (select 1 from jsonb_array_elements(v_entrada) x where jsonb_typeof(x) = 'object' and coalesce(x->>'seq', '') = '') then
    v_entrada := sf_ordem_incluir_trechos(p_ordem_id, v_pmo, v_op, v_entrada);
  end if;
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
              and e.tipo <> 'grupo_prt'  -- 0197: o bipe do grupo (GRUPO[...]) não é SN
         )
         select 1 from usados u
          where not coalesce((select bool_or(sf_sn_na_faixa(f.sn_ini, f.sn_fim, u.sn))
                                from jsonb_to_recordset(v_f) f(seq int, sn_ini text, sn_fim text) where f.seq = t.seq), false)) then
      raise exception 'PRT_FAIXA_COM_HISTORICO:%', t.codigo;
    end if;
  end loop;

  -- 0195: PRT da própria OP na receita só com série própria (a série NOVA; item de posto da rota nova: o único gravado),
  -- a não ser que o código seja também a PMO de uma OP cadastrada (aí vale como PMO)
  select btrim(c->>'pmo') into v_rep
    from jsonb_array_elements(v_comp) c
    join jsonb_to_recordset(v_t) t2(seq int, codigo text, tipo text, sn_modo text)
      on t2.tipo = 'prt' and lower(btrim(t2.codigo)) = lower(btrim(coalesce(c->>'pmo', '')))
   where t2.sn_modo <> 'proprio'
     and exists (select 1 from jsonb_to_recordset(v_p) p(posto text) where p.posto = c->>'posto')
     and not exists (select 1 from sf_ordens o2 where lower(btrim(o2.pmo)) = lower(btrim(c->>'pmo')))
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

notify pgrst, 'reload schema';
