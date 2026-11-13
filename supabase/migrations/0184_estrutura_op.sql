-- 0184: ESTRUTURA DA OP (receita por PMO) — o ShopFloor aponta cada PRT no Compels quando a peça é aprovada no
-- posto que conclui o trecho dela. Spec: docs/superpowers/specs/2026-11-13-estrutura-op-receita-design.md
--
-- 1. sf_estruturas / sf_estrutura_trechos: a RECEITA, uma por PMO, em 'rascunho' (importada do Compels, falta
--    conferir os postos) ou 'ativa' (vale para OP nova). Só 'ativa' é copiada para a OP.
-- 2. sf_ordem_trechos: a CÓPIA da receita na OP (editar a receita não muda OP em andamento) + a OP filha do
--    Compels casada pelo código (compels_op; null = não achada, a linha da fila espera).
-- 3. sf_estoque_envios.ordem_id: liga a linha da fila à OP do ShopFloor. As linhas de PRT têm pmo = código da
--    PRT e op = OP filha, para o adaptador do Compels resolver tudo sem mudança; ordem_id é o que diz "esta
--    linha é PRT" e de qual OP ela veio (liberação, Fluxo).
-- 4. Triggers em sf_registros (cobrem TODOS os caminhos de bipe):
--    - AFTER INSERT: registro não reprovado, com SN, no posto que conclui um trecho → entrada da PRT, UMA vez por
--      peça e trecho (existe entrada viva = não cancelada e com saldo → não duplica). quantidade = pecas (painel).
--    - AFTER DELETE (cancelar lançamento move o registro p/ auditoria): se não sobrou outro registro aprovado da
--      peça no mesmo posto, desfaz com a regra da sf_estoque_reverter (0132): pendente e INTOCADA → cancela;
--      enviada OU tocada (tentativas > 0, reserva viva de 15 min, já estornada) → estorno do saldo ligado à
--      entrada (entrada_id) e baixa do saldo (estornado). A sf_estoque_reservar segura esse estorno até a
--      entrada dele estar ok. As duas funções travam por peça/trecho.
-- 5. sf_trecho_chave: a chave das linhas de PRT, PRT/<ordem_id>/<codigo>/<posto>/<alvo>/E<n> (S<n> no estorno).
--    Não depende da op da linha (que muda quando a filha é casada de novo), então não se repete.
-- 6. sf_resumo_trechos_op: o resumo por trecho que o card do Fluxo mostra, numa consulta só.

create table if not exists public.sf_estruturas (
  pmo          text primary key,
  situacao     text not null default 'rascunho' check (situacao in ('rascunho', 'ativa')),
  origem       text not null default 'manual',
  criado_em    timestamptz not null default now(),
  criado_por   text not null default '',
  alterado_em  timestamptz not null default now(),
  alterado_por text not null default ''
);

create table if not exists public.sf_estrutura_trechos (
  pmo           text not null references public.sf_estruturas(pmo) on delete cascade,
  seq           int  not null check (seq >= 1),
  codigo        text not null check (btrim(codigo) <> ''),
  descricao     text not null default '',
  posto_conclui text references public.sf_postos(chave),
  sn_modo       text not null default 'mesmo' check (sn_modo in ('mesmo', 'proprio')),
  estoque       text not null default 'EINTER' check (estoque in ('PA', 'EINTER')),
  primary key (pmo, seq)
);

create table if not exists public.sf_ordem_trechos (
  ordem_id      uuid not null references public.sf_ordens(id) on delete cascade,
  seq           int  not null check (seq >= 1),
  codigo        text not null,
  posto_conclui text not null,
  sn_modo       text not null default 'mesmo' check (sn_modo in ('mesmo', 'proprio')),
  estoque       text not null default 'EINTER' check (estoque in ('PA', 'EINTER')),
  compels_op    text,
  primary key (ordem_id, seq)
);
create index if not exists sf_ordem_trechos_posto on public.sf_ordem_trechos (ordem_id, posto_conclui);

alter table public.sf_estoque_envios add column if not exists ordem_id uuid;
drop index if exists public.sf_estoque_envios_ordem;
create index if not exists sf_estoque_envios_ordem_alvo on public.sf_estoque_envios (ordem_id, pmo, posto, alvo)
  where ordem_id is not null;

alter table public.sf_estruturas enable row level security;
alter table public.sf_estrutura_trechos enable row level security;
alter table public.sf_ordem_trechos enable row level security;

drop policy if exists sf_estruturas_select on public.sf_estruturas;
create policy sf_estruturas_select on public.sf_estruturas
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_estruturas_admin on public.sf_estruturas;
create policy sf_estruturas_admin on public.sf_estruturas
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

drop policy if exists sf_estrutura_trechos_select on public.sf_estrutura_trechos;
create policy sf_estrutura_trechos_select on public.sf_estrutura_trechos
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_estrutura_trechos_admin on public.sf_estrutura_trechos;
create policy sf_estrutura_trechos_admin on public.sf_estrutura_trechos
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

drop policy if exists sf_ordem_trechos_select on public.sf_ordem_trechos;
create policy sf_ordem_trechos_select on public.sf_ordem_trechos
  for select using ((select tem_permissao('shopfloor', 'visualizar')));
drop policy if exists sf_ordem_trechos_admin on public.sf_ordem_trechos;
create policy sf_ordem_trechos_admin on public.sf_ordem_trechos
  for all using ((select tem_permissao('shopfloor', 'administrar')))
  with check ((select tem_permissao('shopfloor', 'administrar')));

revoke all on public.sf_estruturas, public.sf_estrutura_trechos, public.sf_ordem_trechos from public, anon;
grant select, insert, update, delete on public.sf_estruturas, public.sf_estrutura_trechos, public.sf_ordem_trechos
  to authenticated, service_role;

-- ---------- salvar a receita de uma PMO numa transação só ----------
create or replace function public.sf_salvar_estrutura(p_pmo text, p_trechos jsonb, p_usuario text, p_origem text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (select tem_permissao('shopfloor', 'administrar')) then raise exception 'sem permissão'; end if;
  insert into sf_estruturas (pmo, situacao, origem, criado_por, alterado_por)
  values (p_pmo, 'rascunho', coalesce(p_origem, 'manual'), p_usuario, p_usuario)
  on conflict (pmo) do update
    set situacao = 'rascunho', alterado_em = now(), alterado_por = p_usuario,
        origem = case when p_origem is null then sf_estruturas.origem else p_origem end;
  delete from sf_estrutura_trechos where pmo = p_pmo;
  insert into sf_estrutura_trechos (pmo, seq, codigo, descricao, posto_conclui, sn_modo, estoque)
  select p_pmo, (t->>'seq')::int, btrim(t->>'codigo'), coalesce(t->>'descricao', ''), nullif(t->>'posto_conclui', ''),
         coalesce(t->>'sn_modo', 'mesmo'), coalesce(t->>'estoque', 'EINTER')
    from jsonb_array_elements(coalesce(p_trechos, '[]'::jsonb)) t;
end $$;
revoke all on function public.sf_salvar_estrutura(text, jsonb, text, text) from public, anon;
grant execute on function public.sf_salvar_estrutura(text, jsonb, text, text) to authenticated, service_role;

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
     where o.pmo = new.pmo and o.op = new.op and ot.posto_conclui = new.posto
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
     where o.pmo = old.pmo and o.op = old.op and ot.posto_conclui = old.posto
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
     where o.pmo = p_pmo and o.op = p_op
     order by ot.seq;
end
$func$;
revoke all on function public.sf_resumo_trechos_op(text, text) from public, anon;
grant execute on function public.sf_resumo_trechos_op(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
