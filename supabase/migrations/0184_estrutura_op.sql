-- 0184: ESTRUTURA DA OP — a OP do ShopFloor é uma cadeia de OPs do Compels (PRTs + PMO) dividida em TRECHOS.
-- Spec: docs/superpowers/specs/2026-11-18-cadastro-op-compels-design.md (substitui a "receita por PMO" de 13/11,
-- que nunca foi para produção: esta migração foi REESCRITA no lugar antes do primeiro deploy).
--
-- 1. sf_ordem_trechos: um trecho por OP do Compels, na ordem da rota. tipo 'prt' (as filhas) ou 'pmo' (o ÚLTIMO
--    trecho, a própria OP). Só os trechos 'prt' são apontados pelos triggers abaixo; a PMO segue pelo Almoxarifado
--    de sempre (0175). posto_conclui = o último posto do trecho (derivado pelas funções de gravação).
-- 2. sf_ordem_postos.trecho_seq / sf_ordem_faixas.trecho_seq: a qual trecho o posto/a faixa pertence. null = OP
--    antiga (ou OP inteira). Sem FK de propósito: uma FK composta para sf_ordem_trechos faria o PostgREST ver essas
--    tabelas como junção sf_ordens↔sf_ordem_trechos e o embed sf_ordem_trechos(...) ficaria ambíguo (PGRST201).
--    Quem grava é só sf_cadastrar_op / sf_ordem_regravar_postos / sf_ordem_regravar_faixas.
-- 3. sf_estoque_envios.ordem_id: liga a linha da fila à OP do ShopFloor (linhas de PRT: pmo = código da PRT,
--    op = OP filha), para o adaptador do Compels resolver tudo sem mudança.
-- 4. Triggers em sf_registros (cobrem TODOS os caminhos de bipe):
--    - AFTER INSERT: registro não reprovado, com SN, no posto que conclui um trecho PRT → entrada da PRT, UMA vez por
--      peça e trecho (existe entrada viva = não cancelada e com saldo → não duplica). quantidade = pecas (painel).
--    - AFTER DELETE (cancelar lançamento): se não sobrou outro registro aprovado da peça no mesmo posto, desfaz com a
--      regra da sf_estoque_reverter (0132): pendente e INTOCADA → cancela; enviada OU tocada → estorno ligado à
--      entrada (entrada_id) e baixa do saldo. As duas funções travam por peça/trecho.
-- 5. sf_trecho_chave: PRT/<ordem_id>/<codigo>/<posto>/<alvo>/E<n> (S<n> no estorno).
-- 6. sf_resumo_trechos_op: o resumo por trecho PRT que o card do Fluxo mostra, numa consulta só.
-- 7. sf_compels_ops: ESPELHO (só leitura) das OPs ativas do Compels, gravado pelo cron de 10 em 10 minutos
--    (sf_compels_ops_sincronizar, só service_role). A que some da lista vira ativa = false (nunca é apagada).
-- 8. Cadastro e edição (security definer, shopfloor.administrar): sf_cadastrar_op (OP + trechos + postos +
--    faixas + componentes + burn-in numa transação), sf_ordem_regravar_postos e sf_ordem_regravar_faixas (a edição
--    preserva os trechos), sf_ultima_op_da_pmo (leitura: os postos da última OP da PMO, para copiar).
--
-- ORDEM DE DEPLOY: migração ANTES do app (o app novo chama as funções novas). Aplicada fora de ordem no RDS (que
-- está na 0190): cria objetos novos, colunas anuláveis e triggers em sf_registros, e apaga os objetos da receita
-- de 13/11 (sf_salvar_estrutura, sf_estrutura_trechos, sf_estruturas) — no RDS eles não existem, então o drop
-- não faz nada.
-- Rollback: docs/operacao/estrutura-op/rollback-0184.sql. Idempotente (psql -1 -v ON_ERROR_STOP=1 -f).

-- a versão de 13/11 (receita por PMO) nunca foi para produção; se algum banco local a tiver, ela sai aqui
drop function if exists public.sf_salvar_estrutura(text, jsonb, text, text);
drop table if exists public.sf_estrutura_trechos;
drop table if exists public.sf_estruturas;

create table if not exists public.sf_ordem_trechos (
  ordem_id      uuid not null references public.sf_ordens(id) on delete cascade,
  seq           int  not null check (seq >= 1),
  codigo        text not null,
  tipo          text not null default 'prt' check (tipo in ('prt', 'pmo')),
  posto_conclui text not null,
  sn_modo       text not null default 'mesmo' check (sn_modo in ('mesmo', 'proprio')),
  estoque       text not null default 'EINTER' check (estoque in ('PA', 'EINTER')),
  compels_op    text,
  primary key (ordem_id, seq)
);
-- banco local que tenha a versão de 13/11 (sem tipo): a coluna entra aqui
alter table public.sf_ordem_trechos add column if not exists tipo text not null default 'prt' check (tipo in ('prt', 'pmo'));
create index if not exists sf_ordem_trechos_posto on public.sf_ordem_trechos (ordem_id, posto_conclui);

alter table public.sf_estoque_envios add column if not exists ordem_id uuid;
drop index if exists public.sf_estoque_envios_ordem;
create index if not exists sf_estoque_envios_ordem_alvo on public.sf_estoque_envios (ordem_id, pmo, posto, alvo)
  where ordem_id is not null;

alter table public.sf_ordem_trechos enable row level security;

drop policy if exists sf_ordem_trechos_select on public.sf_ordem_trechos;
create policy sf_ordem_trechos_select on public.sf_ordem_trechos
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_ordem_trechos_admin on public.sf_ordem_trechos;
create policy sf_ordem_trechos_admin on public.sf_ordem_trechos
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

revoke all on public.sf_ordem_trechos from public, anon;
grant select, insert, update, delete on public.sf_ordem_trechos to authenticated, service_role;

-- ---------- a chave de idempotência das linhas de PRT ----------
-- O mesmo papel da sf_estoque_chave (0132), mas pela OP do ShopFloor e pelo código da PRT, e NÃO pela op da linha:
-- essa op é a filha do Compels, que o gravarFilhas/limparFilhas reaponta nas pendentes. Contando por (pmo, op, ...)
-- uma linha reapontada deixava o contador de outra op repetir uma chave já gasta (rebipe → índice único → o bipe
-- inteiro falhava). O final `[ES]<n>` é o mesmo da 0132, para a coluna seq_chave continuar lendo o contador.
-- Quem chama já segura a trava por peça/trecho (pg_advisory_xact_lock), então duas contagens não se cruzam.
create or replace function public.sf_trecho_chave(
  p_ordem_id uuid, p_codigo text, p_posto text, p_alvo text, p_operacao text
) returns text language sql volatile security definer set search_path = public as $func$
  select 'PRT/' || p_ordem_id::text || '/' || p_codigo || '/' || p_posto || '/' || p_alvo || '/'
         || case p_operacao when 'estorno' then 'S' else 'E' end
         || (select count(*) + 1 from public.sf_estoque_envios e
              where e.ordem_id = p_ordem_id and e.pmo = p_codigo and e.posto = p_posto
                and e.alvo = p_alvo and e.operacao = p_operacao)
$func$;
revoke all on function public.sf_trecho_chave(uuid, text, text, text, text) from public, anon, authenticated, service_role;

-- ---------- enfileirar a PRT no bipe aprovado ----------
create or replace function public.sf_trecho_enfileirar()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
begin
  if new.numero_serie_norm = '' or new.status ilike 'reprov%' then
    return new;
  end if;
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

-- ---------- desfazer quando o registro sai ----------
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

revoke all on function public.sf_trecho_enfileirar() from public, anon, authenticated;
revoke all on function public.sf_trecho_desfazer() from public, anon, authenticated;

drop trigger if exists sf_registros_trecho_ins on public.sf_registros;
create trigger sf_registros_trecho_ins after insert on public.sf_registros
  for each row execute function public.sf_trecho_enfileirar();
drop trigger if exists sf_registros_trecho_del on public.sf_registros;
create trigger sf_registros_trecho_del after delete on public.sf_registros
  for each row execute function public.sf_trecho_desfazer();

-- ---------- resumo por trecho para o card do Fluxo (uma consulta só) ----------
-- apontadas = entradas ok − estornos ok; na_fila = entradas pendentes não canceladas; motivo = erro da pendente mais
-- antiga. security definer porque a fila não tem policy de escrita e a leitura é por OP; a permissão é conferida aqui.
create or replace function public.sf_resumo_trechos_op(p_pmo text, p_op text)
returns table (posto text, codigo text, compels_op text, apontadas int, na_fila int, motivo text)
language plpgsql stable security definer set search_path = public as $func$
begin
  if not (select tem_permissao('shopfloor', 'visualizar')) then raise exception 'sem permissão'; end if;
  return query
    select ot.posto_conclui, ot.codigo, ot.compels_op,
           coalesce((select sum(case when e.operacao = 'estorno' then -e.quantidade else e.quantidade end)
                       from public.sf_estoque_envios e
                      where e.ordem_id = o.id and e.pmo = ot.codigo and e.ok), 0)::int,
           coalesce((select sum(e.quantidade)
                       from public.sf_estoque_envios e
                      where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
                        and not e.ok and e.cancelado_em is null), 0)::int,
           (select e.erro
              from public.sf_estoque_envios e
             where e.ordem_id = o.id and e.pmo = ot.codigo and e.operacao = 'entrada'
               and not e.ok and e.cancelado_em is null
             order by e.criado_em, e.id limit 1)
      from public.sf_ordens o
      join public.sf_ordem_trechos ot on ot.ordem_id = o.id
     where o.pmo = p_pmo and o.op = p_op and ot.tipo = 'prt'
     order by ot.seq;
end
$func$;
revoke all on function public.sf_resumo_trechos_op(text, text) from public, anon;
grant execute on function public.sf_resumo_trechos_op(text, text) to authenticated, service_role;

-- ---------- trecho de cada posto e de cada faixa (null = OP antiga / OP inteira) ----------
alter table public.sf_ordem_postos add column if not exists trecho_seq int;
alter table public.sf_ordem_faixas add column if not exists trecho_seq int;
comment on column public.sf_ordem_postos.trecho_seq is 'Trecho (sf_ordem_trechos.seq) dono do posto. null = OP antiga. 0184.';
comment on column public.sf_ordem_faixas.trecho_seq is 'Trecho (sf_ordem_trechos.seq) dono da faixa. null = da OP inteira (OP antiga). 0184.';

-- ---------- espelho das OPs ativas do Compels (só leitura; quem grava é o cron) ----------
create table if not exists public.sf_compels_ops (
  numero               int primary key,
  id_compels           int not null,
  codigo               text not null,
  descricao            text not null default '',
  situacao             text not null default '',
  nivel                int not null default 1,
  quantidade           numeric not null default 0,
  quantidade_produzida numeric not null default 0,
  mae_numero           int,
  principal_numero     int,
  cliente              text not null default '',
  data_documento       date,
  ativa                boolean not null default true,
  lido_em              timestamptz not null default now()
);
create index if not exists sf_compels_ops_codigo on public.sf_compels_ops (codigo) where ativa;
create index if not exists sf_compels_ops_mae on public.sf_compels_ops (mae_numero);
alter table public.sf_compels_ops enable row level security;
drop policy if exists sf_compels_ops_select on public.sf_compels_ops;
create policy sf_compels_ops_select on public.sf_compels_ops
  for select using ((select tem_permissao('shopfloor', 'administrar')));
revoke all on public.sf_compels_ops from public, anon, authenticated;
grant select on public.sf_compels_ops to authenticated;
grant select, insert, update on public.sf_compels_ops to service_role;

-- O cron manda a lista INTEIRA de OPs ativas: upsert de todas e as que não vieram viram ativa = false.
-- Lista vazia é recusada (um Compels fora do ar nunca pode "inativar tudo").
create or replace function public.sf_compels_ops_sincronizar(p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = public as $func$
declare
  v_novas int;
  v_atualizadas int;
  v_inativadas int;
begin
  -- separado de propósito: o OR do plpgsql não garante a ordem, e jsonb_array_length num objeto dá erro
  if jsonb_typeof(p_ops) is distinct from 'array' then
    raise exception 'LISTA_VAZIA';
  elsif jsonb_array_length(p_ops) = 0 then
    raise exception 'LISTA_VAZIA';
  end if;
  with dados as (
    select distinct on ((x->>'numero')::int)
           (x->>'numero')::int as numero, (x->>'id_compels')::int as id_compels, btrim(x->>'codigo') as codigo,
           coalesce(x->>'descricao', '') as descricao, coalesce(x->>'situacao', '') as situacao,
           coalesce((x->>'nivel')::int, 1) as nivel, coalesce((x->>'quantidade')::numeric, 0) as quantidade,
           coalesce((x->>'quantidade_produzida')::numeric, 0) as quantidade_produzida,
           (x->>'mae_numero')::int as mae_numero, (x->>'principal_numero')::int as principal_numero,
           coalesce(x->>'cliente', '') as cliente, (x->>'data_documento')::date as data_documento
      from jsonb_array_elements(p_ops) x
     order by (x->>'numero')::int
  ), gravadas as (
    insert into sf_compels_ops (numero, id_compels, codigo, descricao, situacao, nivel, quantidade,
                                quantidade_produzida, mae_numero, principal_numero, cliente, data_documento,
                                ativa, lido_em)
    select numero, id_compels, codigo, descricao, situacao, nivel, quantidade, quantidade_produzida,
           mae_numero, principal_numero, cliente, data_documento, true, now()
      from dados
    on conflict (numero) do update
      set id_compels = excluded.id_compels, codigo = excluded.codigo, descricao = excluded.descricao,
          situacao = excluded.situacao, nivel = excluded.nivel, quantidade = excluded.quantidade,
          quantidade_produzida = excluded.quantidade_produzida, mae_numero = excluded.mae_numero,
          principal_numero = excluded.principal_numero, cliente = excluded.cliente,
          data_documento = excluded.data_documento, ativa = true, lido_em = now()
    returning (xmax = 0) as nova
  )
  select count(*) filter (where nova), count(*) filter (where not nova) into v_novas, v_atualizadas from gravadas;
  update sf_compels_ops set ativa = false
   where ativa and numero not in (select (x->>'numero')::int from jsonb_array_elements(p_ops) x);
  get diagnostics v_inativadas = row_count;
  return jsonb_build_object('novas', v_novas, 'atualizadas', v_atualizadas, 'inativadas', v_inativadas);
end
$func$;
revoke all on function public.sf_compels_ops_sincronizar(jsonb) from public, anon, authenticated;
grant execute on function public.sf_compels_ops_sincronizar(jsonb) to service_role;

-- ---------- cadastro da OP nova numa transação: OP + trechos + postos + faixas + componentes + burn-in ----------
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
  if jsonb_array_length(v_trechos) = 0 then raise exception 'SEM_TRECHO'; end if;
  select max((x->>'seq')::int) into v_pmo_seq from jsonb_array_elements(v_trechos) x;
  if (select count(*) from jsonb_array_elements(v_trechos) x where x->>'tipo' = 'pmo') <> 1
     or (select x->>'tipo' from jsonb_array_elements(v_trechos) x where (x->>'seq')::int = v_pmo_seq limit 1) <> 'pmo' then
    raise exception 'PMO_NAO_E_ULTIMO';
  end if;
  select btrim(x->>'codigo') into v_rep from jsonb_array_elements(v_trechos) x
   where jsonb_array_length(coalesce(x->'postos', '[]'::jsonb)) = 0 order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_POSTO:%', v_rep; end if;
  select pp into v_rep from jsonb_array_elements(v_trechos) x, jsonb_array_elements_text(x->'postos') pp
   group by pp having count(*) > 1 order by pp limit 1;
  if v_rep is not null then raise exception 'POSTO_REPETIDO:%', v_rep; end if;
  select btrim(x->>'codigo') into v_rep from jsonb_array_elements(v_trechos) x
   where (x->>'tipo' = 'pmo' or x->>'sn_modo' = 'proprio') and jsonb_array_length(coalesce(x->'faixas', '[]'::jsonb)) = 0
   order by (x->>'seq')::int limit 1;
  if v_rep is not null then raise exception 'TRECHO_SEM_FAIXA:%', v_rep; end if;
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

-- ---------- edição: regrava a rota preservando o trecho de cada posto ----------
create or replace function public.sf_ordem_regravar_postos(p_ordem_id uuid, p_postos text[])
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo_seq int;
  v_antigos jsonb;
  v_vazio text;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
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

-- ---------- edição: regrava as faixas da PMO; as próprias das PRTs ficam (depois) ----------
create or replace function public.sf_ordem_regravar_faixas(p_ordem_id uuid, p_faixas jsonb)
returns void language plpgsql security definer set search_path = public as $func$
declare
  v_pmo_seq int;
  v_prt jsonb;
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  select seq into v_pmo_seq from sf_ordem_trechos where ordem_id = p_ordem_id and tipo = 'pmo';
  select coalesce(jsonb_agg(jsonb_build_object('sn_ini', f.sn_ini, 'sn_fim', f.sn_fim, 'trecho_seq', f.trecho_seq) order by f.seq), '[]'::jsonb)
    into v_prt
    from sf_ordem_faixas f
   where f.ordem_id = p_ordem_id and f.trecho_seq is not null and f.trecho_seq is distinct from v_pmo_seq;
  delete from sf_ordem_faixas where ordem_id = p_ordem_id;
  insert into sf_ordem_faixas (ordem_id, seq, sn_ini, sn_fim, trecho_seq)
  select p_ordem_id, row_number() over (order by z.grupo, z.ord), z.sn_ini, z.sn_fim, z.trecho_seq
    from (
      select 1 as grupo, a.ord, btrim(a.f->>'sn_ini') as sn_ini, btrim(a.f->>'sn_fim') as sn_fim, v_pmo_seq as trecho_seq
        from jsonb_array_elements(case when jsonb_typeof(p_faixas) = 'array' then p_faixas else '[]'::jsonb end)
             with ordinality a(f, ord)
      union all
      select 2, b.ord, b.f->>'sn_ini', b.f->>'sn_fim', (b.f->>'trecho_seq')::int
        from jsonb_array_elements(v_prt) with ordinality b(f, ord)
    ) z;
end
$func$;
revoke all on function public.sf_ordem_regravar_faixas(uuid, jsonb) from public, anon;
grant execute on function public.sf_ordem_regravar_faixas(uuid, jsonb) to authenticated, service_role;

-- ---------- a última OP da PMO (para a OP nova copiar os postos) — leitura com a RLS de quem chama ----------
create or replace function public.sf_ultima_op_da_pmo(p_pmo text)
returns jsonb language sql stable security invoker set search_path = public as $func$
  with alvo as (
    select o.* from sf_ordens o
     where o.pmo = p_pmo or left(o.pmo, length(p_pmo) + 1) = p_pmo || '_'
     order by (o.pmo = p_pmo) desc, o.created_at desc, o.id
     limit 1
  )
  select jsonb_build_object(
    'op', a.op, 'cliente', a.cliente, 'descricao', a.descricao,
    'placas_por_painel', a.placas_por_painel, 'embalagem_individual', a.embalagem_individual,
    'postos', coalesce((select jsonb_agg(jsonb_build_object('posto', p.posto, 'trecho_codigo', t.codigo) order by p.ordem)
                          from sf_ordem_postos p
                          left join sf_ordem_trechos t on t.ordem_id = p.ordem_id and t.seq = p.trecho_seq
                         where p.ordem_id = a.id), '[]'::jsonb),
    'componentes', coalesce((select jsonb_agg(jsonb_build_object('posto', c.posto, 'pmo', c.pmo_componente) order by c.posto, c.pmo_componente)
                               from sf_ordem_componentes c where c.ordem_id = a.id), '[]'::jsonb),
    'burnin', coalesce((select jsonb_agg(jsonb_build_object('posto', b.posto, 'tempo_min', b.tempo_min) order by b.posto)
                          from sf_ordem_burnin b where b.ordem_id = a.id), '[]'::jsonb))
    from alvo a
$func$;
revoke all on function public.sf_ultima_op_da_pmo(text) from public, anon;
grant execute on function public.sf_ultima_op_da_pmo(text) to authenticated, service_role;

notify pgrst, 'reload schema';
