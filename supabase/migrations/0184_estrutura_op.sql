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
--      peça e trecho (o líquido entradas − estornos vigentes é > 0 → não duplica). quantidade = pecas (painel).
--    - AFTER DELETE (cancelar lançamento move o registro p/ auditoria): se não sobrou outro registro aprovado da
--      peça no mesmo posto, desfaz: pendente → cancela; já enviada → estorno (mesma regra da 0132: não se estorna
--      o que ainda não saiu).

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
create index if not exists sf_estoque_envios_ordem on public.sf_estoque_envios (ordem_id) where ordem_id is not null;

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

-- ---------- enfileirar a PRT no bipe aprovado ----------
create or replace function public.sf_trecho_enfileirar()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_liquido int;
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
    select count(*) filter (where e.operacao = 'entrada') - count(*) filter (where e.operacao = 'estorno')
      into v_liquido
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = new.posto
       and e.alvo = new.numero_serie_norm and e.cancelado_em is null;
    if v_liquido > 0 then
      continue;  -- a peça já entrou neste trecho (reaprovação depois da Manutenção, rebipe): não duplica
    end if;
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id)
    values
      (public.sf_estoque_chave(t.codigo, t.op_filha, new.posto, new.numero_serie_norm, 'entrada'), 'entrada',
       t.codigo, t.op_filha, new.posto, 'serie', coalesce(nullif(new.numero_serie, ''), new.numero_serie_norm),
       new.numero_serie_norm, greatest(coalesce(new.pecas, 1), 1), t.estoque, t.ordem_id);
  end loop;
  return new;
end
$func$;

-- ---------- desfazer quando o registro sai ----------
create or replace function public.sf_trecho_desfazer()
returns trigger language plpgsql security definer set search_path = public as $func$
declare
  t record;
  v_id uuid;
  v_env record;
  v_liquido int;
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
    -- outra aprovação da mesma peça no mesmo posto continua valendo: nada a desfazer
    if exists (select 1 from public.sf_registros r
                where r.pmo = old.pmo and r.op = old.op and r.posto = old.posto
                  and r.numero_serie_norm = old.numero_serie_norm and r.id <> old.id
                  and r.status not ilike 'reprov%') then
      continue;
    end if;
    -- ainda na fila → cancela (não se estorna o que não saiu)
    select e.id into v_id
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada' and not e.ok and e.cancelado_em is null
     order by e.criado_em desc limit 1;
    if v_id is not null then
      update public.sf_estoque_envios set cancelado_em = now() where id = v_id;
      continue;
    end if;
    -- já enviada e ainda não estornada → estorno com a mesma op, quantidade e estoque
    select count(*) filter (where e.operacao = 'entrada') - count(*) filter (where e.operacao = 'estorno')
      into v_liquido
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.cancelado_em is null;
    if v_liquido <= 0 then
      continue;
    end if;
    select e.op, e.bipe, e.quantidade, e.estoque into v_env
      from public.sf_estoque_envios e
     where e.ordem_id = t.ordem_id and e.pmo = t.codigo and e.posto = old.posto
       and e.alvo = old.numero_serie_norm and e.operacao = 'entrada' and e.ok
     order by e.criado_em desc limit 1;
    insert into public.sf_estoque_envios
      (chave, operacao, pmo, op, posto, tipo, bipe, serie_norm, quantidade, estoque, ordem_id)
    values
      (public.sf_estoque_chave(t.codigo, v_env.op, old.posto, old.numero_serie_norm, 'estorno'), 'estorno',
       t.codigo, v_env.op, old.posto, 'serie', v_env.bipe, old.numero_serie_norm, v_env.quantidade, v_env.estoque,
       t.ordem_id);
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

notify pgrst, 'reload schema';
