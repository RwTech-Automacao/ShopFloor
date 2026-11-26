-- =============================================================
-- 0198 — SAT: ORDEM DE SERVIÇO (entrega 1: OS + etapas + manutenção, relógio em garantia)
-- (spec docs/superpowers/specs/2026-11-26-sat-ordem-servico-design.md;
--  plano docs/superpowers/plans/2026-11-26-sat-ordem-servico-entrega-1.md)
--
-- A OS deixa de existir no Compels e passa a existir SÓ aqui: uma por relógio (`sat_entradas`), criada pelo banco
-- na entrada (gatilho `sat_entradas_ordem`) e, nesta migração, para as entradas que já existem (backfill, na ordem
-- em que chegaram). Nenhuma função da entrada (0187/0190) é reescrita: a OS se move por gatilhos.
--
--   - `sat_numeracao`: o último número usado por ano. A OS é `NNNN/AA`, CONTINUANDO a sequência do Compels.
--       ⚠️ SEMENTE: 2026 → 396 (última OS do Compels em 26/11/2026 = 0396/26). Se o Compels abrir mais OS até o
--       deploy, TROQUE o 396 abaixo ANTES de aplicar no RDS (o backfill numera na hora). Depois de aplicada, só
--       para frente: `update public.sat_numeracao set ultimo = <número> where ano = 2026;`.
--       Ano sem linha começa em 1 (o Compels não abre mais OS).
--   - `sat_defeitos`: a lista de defeitos. A carga dos 88 do Compels NÃO está aqui (a migração não fala com o
--     Compels): `node tools/compels/defeitos-sat.mjs > defeitos.sql` gera o SQL, aplicado com `psql -1 -f`.
--   - `sat_ordens`, `sat_ordem_defeitos`, `sat_ordem_pecas`, `sat_ordem_ns`, `sat_ordem_historico` (`seq` ordena a
--     linha do tempo: duas linhas no mesmo instante têm o mesmo `em`).
--   - Etapas desta entrega: recebido → nota_pendente | disponivel → em_manutencao → qualidade (para aqui).
--   - Tipo pela garantia da planilha (`sat__tipo_da_garantia`); recalculado enquanto a OS não passou da manutenção.
--   - RLS: leitura com sat.visualizar (`(select tem_permissao(...))`, InitPlan — padrão da 0096); SEM policy de
--     escrita: só pelas funções security definer. `sat_numeracao` não tem policy (só as funções leem).
--   - `*_nome`: a tabela `usuarios` não é legível por quem só tem SAT, então o nome fica guardado na linha.
--
-- Aditiva e idempotente (if not exists, create or replace, drop ... if exists, on conflict do nothing).
--   Dev e demo (SQL Editor): cola o arquivo inteiro e roda.
--   RDS:  PGCLIENTENCODING=UTF8 PGPASSFILE=/dev/null psql -W "<conexão>" \
--           -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0198_sat_ordem_servico.sql
--   ROLLBACK (desliga os 4 gatilhos; tabelas e dados ficam): docs/operacao/sat-ordem-servico/rollback-0198.sql
--
-- ⚠️ ORDEM DE DEPLOY: esta migração ANTES do app (as telas novas leem as tabelas). O app antigo não as usa.
-- =============================================================

-- ---------- numeração ----------
create table if not exists public.sat_numeracao (
  ano    int primary key check (ano between 2000 and 2999),
  ultimo int not null check (ultimo >= 0)
);
-- ⚠️ SEMENTE (ver o cabeçalho): última OS do Compels em 2026.
insert into public.sat_numeracao (ano, ultimo) values (2026, 396) on conflict (ano) do nothing;

-- ---------- defeitos ----------
create table if not exists public.sat_defeitos (
  id             uuid primary key default gen_random_uuid(),
  -- código do defeito no Compels (sat/defeito/findAll); null = criado no ShopFloor
  codigo_compels text unique,
  descricao      text not null check (btrim(descricao) <> '' and length(descricao) <= 300),
  ativo          boolean not null default true,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- ---------- a ordem de serviço ----------
create table if not exists public.sat_ordens (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique check (numero ~ '^[0-9]{4,}/[0-9]{2}$'),
  entrada_id    uuid unique references public.sat_entradas(id) on delete restrict,
  -- 'compels' = importada do histórico do Compels (entrega 6), sem entrada
  origem        text not null default 'shopfloor' check (origem in ('shopfloor', 'compels')),
  tipo          text,
  etapa         text not null,
  etapa_desde   timestamptz not null default now(),
  garantia      text not null default '',
  cliente       text not null default '',
  cnpj          text not null default '',
  produto       text not null default '',
  ns_atual      text not null default '',
  modelo        text,
  sequencia     text,
  ticket_os_id  uuid references public.sat_os(id) on delete set null,
  ticket_numero text not null default '',
  laudo         text not null default '' check (length(laudo) <= 4000),
  tecnico       uuid references public.usuarios(id) on delete set null,
  tecnico_nome  text not null default '',
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint sat_ordens_tipo_valido check (tipo is null or tipo in ('em_garantia', 'fora_garantia', 'remanufatura', 'retorno_peca')),
  -- as entregas seguintes trocam esta lista (drop constraint sat_ordens_etapa_valida + add)
  constraint sat_ordens_etapa_valida check (etapa in ('recebido', 'nota_pendente', 'disponivel', 'em_manutencao', 'qualidade')),
  constraint sat_ordens_entrada check ((origem = 'shopfloor') = (entrada_id is not null))
);
create index if not exists sat_ordens_etapa on public.sat_ordens (etapa, etapa_desde);
create index if not exists sat_ordens_ns on public.sat_ordens (sequencia, modelo);
create index if not exists sat_ordens_ticket on public.sat_ordens (ticket_os_id);
create index if not exists sat_ordens_criado_em on public.sat_ordens (criado_em desc);
create index if not exists sat_ordens_produto on public.sat_ordens (upper(btrim(produto)));

create table if not exists public.sat_ordem_defeitos (
  id                uuid primary key default gen_random_uuid(),
  ordem_id          uuid not null references public.sat_ordens(id) on delete cascade,
  defeito_id        uuid not null references public.sat_defeitos(id) on delete restrict,
  -- o texto do defeito no momento do lançamento (a lista pode mudar depois)
  defeito_descricao text not null,
  origem            text not null check (origem in ('manutencao', 'qualidade')),
  solucao           text not null default '' check (length(solucao) <= 2000),
  usuario           uuid references public.usuarios(id) on delete set null,
  usuario_nome      text not null default '',
  em                timestamptz not null default now()
);
create index if not exists sat_ordem_defeitos_ordem on public.sat_ordem_defeitos (ordem_id, em);

create table if not exists public.sat_ordem_pecas (
  id           uuid primary key default gen_random_uuid(),
  ordem_id     uuid not null references public.sat_ordens(id) on delete cascade,
  -- código e descrição do item do Compels (a baixa continua pelo pedido de venda no Compels)
  codigo       text not null check (codigo ~ '^[A-Z0-9][A-Z0-9_.-]{0,59}$'),
  descricao    text not null default '' check (length(descricao) <= 300),
  quantidade   numeric(12, 3) not null check (quantidade > 0 and quantidade <= 9999),
  situacao     text not null default 'trocada' check (situacao in ('trocada', 'devolvida')),
  usuario      uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null default '',
  em           timestamptz not null default now()
);
create index if not exists sat_ordem_pecas_ordem on public.sat_ordem_pecas (ordem_id, em);
create index if not exists sat_ordem_pecas_codigo on public.sat_ordem_pecas (codigo);

create table if not exists public.sat_ordem_ns (
  id               uuid primary key default gen_random_uuid(),
  ordem_id         uuid not null references public.sat_ordens(id) on delete cascade,
  ns_antigo        text not null,
  modelo_antigo    text,
  sequencia_antigo text,
  ns_novo          text not null check (btrim(ns_novo) <> '' and length(ns_novo) <= 200),
  modelo_novo      text,
  sequencia_novo   text,
  usuario          uuid references public.usuarios(id) on delete set null,
  usuario_nome     text not null default '',
  em               timestamptz not null default now()
);
create index if not exists sat_ordem_ns_ordem on public.sat_ordem_ns (ordem_id, em);
create index if not exists sat_ordem_ns_antigo on public.sat_ordem_ns (sequencia_antigo, modelo_antigo);
create index if not exists sat_ordem_ns_novo on public.sat_ordem_ns (sequencia_novo, modelo_novo);

create table if not exists public.sat_ordem_historico (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  ordem_id     uuid not null references public.sat_ordens(id) on delete cascade,
  evento       text not null,
  etapa_de     text,
  etapa_para   text,
  dados        jsonb not null default '{}'::jsonb,
  usuario      uuid references public.usuarios(id) on delete set null,
  usuario_nome text not null default '',
  em           timestamptz not null default now(),
  constraint sat_ordem_historico_evento_valido
    check (evento in ('etapa', 'correcao_etapa', 'garantia', 'defeito', 'peca', 'laudo', 'ns'))
);
create index if not exists sat_ordem_historico_ordem on public.sat_ordem_historico (ordem_id, seq);

-- ---------- RLS: só leitura, com sat.visualizar ----------
alter table public.sat_numeracao enable row level security;
alter table public.sat_defeitos enable row level security;
alter table public.sat_ordens enable row level security;
alter table public.sat_ordem_defeitos enable row level security;
alter table public.sat_ordem_pecas enable row level security;
alter table public.sat_ordem_ns enable row level security;
alter table public.sat_ordem_historico enable row level security;

drop policy if exists sat_defeitos_select on public.sat_defeitos;
create policy sat_defeitos_select on public.sat_defeitos
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordens_select on public.sat_ordens;
create policy sat_ordens_select on public.sat_ordens
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_defeitos_select on public.sat_ordem_defeitos;
create policy sat_ordem_defeitos_select on public.sat_ordem_defeitos
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_pecas_select on public.sat_ordem_pecas;
create policy sat_ordem_pecas_select on public.sat_ordem_pecas
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_ns_select on public.sat_ordem_ns;
create policy sat_ordem_ns_select on public.sat_ordem_ns
  for select using ((select tem_permissao('sat', 'visualizar')));
drop policy if exists sat_ordem_historico_select on public.sat_ordem_historico;
create policy sat_ordem_historico_select on public.sat_ordem_historico
  for select using ((select tem_permissao('sat', 'visualizar')));

revoke all on public.sat_numeracao, public.sat_defeitos, public.sat_ordens, public.sat_ordem_defeitos,
  public.sat_ordem_pecas, public.sat_ordem_ns, public.sat_ordem_historico from public, anon, authenticated;
grant select on public.sat_defeitos, public.sat_ordens, public.sat_ordem_defeitos, public.sat_ordem_pecas,
  public.sat_ordem_ns, public.sat_ordem_historico to authenticated;
grant select, insert, update, delete on public.sat_numeracao, public.sat_defeitos, public.sat_ordens,
  public.sat_ordem_defeitos, public.sat_ordem_pecas, public.sat_ordem_ns, public.sat_ordem_historico to service_role;

-- ---------- auxiliares (uso interno) ----------
-- Garantia da planilha → tipo da OS: 'em_garantia' | 'fora_garantia' | null (a definir). "SEM GARANTIA" antes de
-- "GARANTIA" (a palavra está nas duas).
create or replace function public.sat__tipo_da_garantia(p_garantia text)
returns text
language sql
immutable
set search_path = public
as $func$
  select case
           when g ~ '(SEM GARANTIA|FORA D[AE] GARANTIA|^\s*NAO\M)' then 'fora_garantia'
           when g ~ 'GARANTIA' then 'em_garantia'
           else null
         end
    from (select regexp_replace(btrim(upper(translate(coalesce(p_garantia, ''),
                                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))), '\s+', ' ', 'g') as g) x
$func$;
revoke all on function public.sat__tipo_da_garantia(text) from public, anon, authenticated;

-- O próximo número do ano: 'NNNN/AA'. O upsert trava a linha do ano (duas entradas ao mesmo tempo não repetem).
create or replace function public.sat__proximo_numero(p_ano int)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $func$
declare
  v_n int;
begin
  insert into sat_numeracao as s (ano, ultimo) values (p_ano, 1)
  on conflict (ano) do update set ultimo = s.ultimo + 1
  returning s.ultimo into v_n;
  return case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end || '/' || lpad((p_ano % 100)::text, 2, '0');
end
$func$;
revoke all on function public.sat__proximo_numero(int) from public, anon, authenticated;

-- Um evento no histórico que não muda a etapa (defeito, peça, laudo, NS, garantia).
create or replace function public.sat__ordem_evento(p_ordem uuid, p_evento text, p_dados jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  insert into sat_ordem_historico (ordem_id, evento, dados, usuario, usuario_nome)
  values (p_ordem, p_evento, coalesce(p_dados, '{}'::jsonb), auth.uid(), sat__nome_usuario());
end
$func$;
revoke all on function public.sat__ordem_evento(uuid, text, jsonb) from public, anon, authenticated;

-- ---------- a OS de uma entrada (idempotente: devolve a que já existe) ----------
-- Nasce já na etapa da NF; o histórico grava "→ recebido" e "recebido → etapa" com o responsável da entrada.
create or replace function public.sat__criar_ordem(p_entrada uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_e     sat_entradas;
  v_n     sat_nfs;
  v_g     text;
  v_id    uuid;
  v_etapa text;
  v_num   text;
begin
  select o.id into v_id from sat_ordens o where o.entrada_id = p_entrada;
  if v_id is not null then return v_id; end if;
  select * into v_e from sat_entradas e where e.id = p_entrada;
  if not found then raise exception 'ENTRADA_NAO_ENCONTRADA'; end if;
  select * into v_n from sat_nfs n where n.id = v_e.nf_id;
  select coalesce(s.garantia, '') into v_g from sat_os s where s.id = v_e.os_id;
  v_g := coalesce(v_g, '');
  v_etapa := case when v_n.situacao = 'aprovada' then 'disponivel' else 'nota_pendente' end;
  v_num := sat__proximo_numero(extract(year from (v_e.criado_em at time zone 'America/Sao_Paulo'))::int);

  insert into sat_ordens (numero, entrada_id, tipo, etapa, etapa_desde, garantia, cliente, cnpj, produto, ns_atual,
                          modelo, sequencia, ticket_os_id, ticket_numero, criado_em)
  values (v_num, v_e.id, sat__tipo_da_garantia(v_g), v_etapa, v_e.criado_em, v_g, coalesce(v_n.empresa, ''),
          coalesce(v_n.cnpj, ''), btrim(coalesce(v_e.produto, '')), v_e.ns_escrito, v_e.modelo, v_e.sequencia,
          v_e.os_id, coalesce(v_e.os_numero, ''), v_e.criado_em)
  returning id into v_id;

  insert into sat_ordem_historico (ordem_id, evento, etapa_de, etapa_para, dados, usuario, usuario_nome, em)
  values (v_id, 'etapa', null, 'recebido', jsonb_build_object('nf', v_n.numero),
          v_e.responsavel, v_e.responsavel_nome, v_e.criado_em),
         (v_id, 'etapa', 'recebido', v_etapa, jsonb_build_object('nf', v_n.numero, 'nf_situacao', v_n.situacao),
          v_e.responsavel, v_e.responsavel_nome, v_e.criado_em);
  return v_id;
end
$func$;
revoke all on function public.sat__criar_ordem(uuid) from public, anon, authenticated;

create or replace function public.sat__ordem_na_entrada()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
begin
  perform sat__criar_ordem(new.id);
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_entrada() from public, anon, authenticated;

drop trigger if exists sat_entradas_ordem on public.sat_entradas;
create trigger sat_entradas_ordem after insert on public.sat_entradas
  for each row execute function public.sat__ordem_na_entrada();

-- ---------- backfill: as entradas que já existem, na ordem em que chegaram ----------
-- A linha do tempo delas começa no estado ATUAL da NF (a correção antiga da nota não vira etapa).
do $backfill$
declare
  r record;
begin
  for r in select e.id from public.sat_entradas e
            where not exists (select 1 from public.sat_ordens o where o.entrada_id = e.id)
            order by e.criado_em, e.id loop
    perform public.sat__criar_ordem(r.id);
  end loop;
end
$backfill$;

-- =============================================================
-- PARTE B — a etapa segue a NF; o tipo segue a garantia do ticket
-- =============================================================

-- ---------- mudar a etapa (uso interno): trava a OS, grava etapa e histórico ----------
create or replace function public.sat__ordem_mudar_etapa(p_ordem uuid, p_para text, p_evento text, p_dados jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_de text;
begin
  select o.etapa into v_de from sat_ordens o where o.id = p_ordem for update;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  if v_de = p_para then raise exception 'NADA_A_MUDAR'; end if;
  update sat_ordens set etapa = p_para, etapa_desde = now(), atualizado_em = now() where id = p_ordem;
  insert into sat_ordem_historico (ordem_id, evento, etapa_de, etapa_para, dados, usuario, usuario_nome)
  values (p_ordem, p_evento, v_de, p_para, coalesce(p_dados, '{}'::jsonb), auth.uid(), sat__nome_usuario());
end
$func$;
revoke all on function public.sat__ordem_mudar_etapa(uuid, text, text, jsonb) from public, anon, authenticated;

-- ---------- a NF muda (sat_corrigir_nf / sat_trocar_nf, que já existem) → a OS acompanha ----------
-- Aprovada: nota_pendente → disponivel. Reprovada: disponivel → nota_pendente. Quem já abriu a manutenção fica.
-- Empresa/CNPJ da nota trocada vão para a OS (em qualquer etapa).
create or replace function public.sat__ordem_na_mudanca_nf()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  r       record;
  v_de    text;
  v_para  text;
  v_dados jsonb;
begin
  update sat_ordens o set cliente = new.empresa, cnpj = new.cnpj, atualizado_em = now()
    from sat_entradas e
   where e.nf_id = new.id and o.entrada_id = e.id
     and (o.cliente, o.cnpj) is distinct from (new.empresa, new.cnpj);

  if new.situacao is not distinct from old.situacao then return null; end if;
  v_de   := case when new.situacao = 'aprovada' then 'nota_pendente' else 'disponivel' end;
  v_para := case when new.situacao = 'aprovada' then 'disponivel' else 'nota_pendente' end;
  v_dados := jsonb_build_object('nf', new.numero, 'nf_de', old.numero, 'nf_situacao', new.situacao,
                                'motivos', to_jsonb(new.motivos));
  for r in select o.id from sat_ordens o join sat_entradas e on e.id = o.entrada_id
            where e.nf_id = new.id and o.etapa = v_de
            order by o.criado_em, o.id
              for update of o loop
    -- `for update of o` espera quem estiver mexendo na OS (ex.: iniciar a manutenção) e, em READ COMMITTED, reavalia
    -- o filtro e pula a linha que já saiu de v_de. A conferência abaixo é a rede de segurança: não levanta erro.
    continue when not exists (select 1 from sat_ordens x where x.id = r.id and x.etapa = v_de);
    perform sat__ordem_mudar_etapa(r.id, v_para, 'etapa', v_dados);
  end loop;
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_mudanca_nf() from public, anon, authenticated;

drop trigger if exists sat_nfs_ordem on public.sat_nfs;
create trigger sat_nfs_ordem after update of situacao, empresa, cnpj, numero on public.sat_nfs
  for each row execute function public.sat__ordem_na_mudanca_nf();

-- ---------- garantia/ticket: recalcula enquanto a OS não passou da manutenção ----------
-- Remanufatura e retorno de peça (escolhidos à mão, entrega 4) não voltam a ser garantia.
create or replace function public.sat__ordem_recalcular_garantia(p_ordem uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o        sat_ordens;
  v_ticket   uuid;
  v_num      text;
  v_garantia text;
  v_tipo     text;
begin
  select * into v_o from sat_ordens o where o.id = p_ordem for update;
  if not found or v_o.etapa not in ('recebido', 'nota_pendente', 'disponivel', 'em_manutencao') then return; end if;
  select e.os_id, coalesce(e.os_numero, ''), coalesce(s.garantia, '')
    into v_ticket, v_num, v_garantia
    from sat_entradas e left join sat_os s on s.id = e.os_id
   where e.id = v_o.entrada_id;
  v_garantia := coalesce(v_garantia, '');
  v_num := coalesce(v_num, '');
  v_tipo := case when v_o.tipo in ('remanufatura', 'retorno_peca') then v_o.tipo else sat__tipo_da_garantia(v_garantia) end;
  if (v_ticket, v_num, v_garantia, v_tipo) is not distinct from
     (v_o.ticket_os_id, v_o.ticket_numero, v_o.garantia, v_o.tipo) then
    return;
  end if;
  update sat_ordens set ticket_os_id = v_ticket, ticket_numero = v_num, garantia = v_garantia, tipo = v_tipo,
                        atualizado_em = now()
   where id = p_ordem;
  insert into sat_ordem_historico (ordem_id, evento, dados, usuario, usuario_nome)
  values (p_ordem, 'garantia',
          jsonb_build_object('ticket_de', v_o.ticket_numero, 'ticket_para', v_num,
                             'garantia_de', v_o.garantia, 'garantia_para', v_garantia,
                             'tipo_de', v_o.tipo, 'tipo_para', v_tipo),
          auth.uid(), coalesce(nullif(sat__nome_usuario(), ''), 'planilha'));
end
$func$;
revoke all on function public.sat__ordem_recalcular_garantia(uuid) from public, anon, authenticated;

create or replace function public.sat__ordem_na_troca_de_ticket()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_id uuid;
begin
  select o.id into v_id from sat_ordens o where o.entrada_id = new.id;
  if v_id is not null then perform sat__ordem_recalcular_garantia(v_id); end if;
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_troca_de_ticket() from public, anon, authenticated;

drop trigger if exists sat_entradas_ticket on public.sat_entradas;
create trigger sat_entradas_ticket after update of os_id on public.sat_entradas
  for each row when (old.os_id is distinct from new.os_id)
  execute function public.sat__ordem_na_troca_de_ticket();

create or replace function public.sat__ordem_na_garantia_da_planilha()
returns trigger
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  r record;
begin
  for r in select o.id from sat_ordens o where o.ticket_os_id = new.id loop
    perform sat__ordem_recalcular_garantia(r.id);
  end loop;
  return null;
end
$func$;
revoke all on function public.sat__ordem_na_garantia_da_planilha() from public, anon, authenticated;

drop trigger if exists sat_os_garantia on public.sat_os;
create trigger sat_os_garantia after update of garantia on public.sat_os
  for each row when (old.garantia is distinct from new.garantia)
  execute function public.sat__ordem_na_garantia_da_planilha();


-- ---------- manutenção (sat.manutencao) ----------
-- A OS travada e conferida para lançar na manutenção (uso interno): permissão, existe, está em manutenção.
create or replace function public.sat__ordem_para_manutencao(p_ordem uuid)
returns sat_ordens
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o sat_ordens;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_o from sat_ordens o where o.id = p_ordem for update;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  if v_o.etapa <> 'em_manutencao' then raise exception 'ETAPA_NAO_PERMITE'; end if;
  return v_o;
end
$func$;
revoke all on function public.sat__ordem_para_manutencao(uuid) from public, anon, authenticated;

-- Disponível → em manutenção; o técnico é quem abriu.
create or replace function public.sat_ordem_iniciar_manutencao(p_ordem uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o    sat_ordens;
  v_nome text;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_o from sat_ordens o where o.id = p_ordem for update;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  if v_o.etapa <> 'disponivel' then raise exception 'ETAPA_NAO_PERMITE'; end if;
  v_nome := sat__nome_usuario();
  update sat_ordens set tecnico = auth.uid(), tecnico_nome = v_nome where id = p_ordem;
  perform sat__ordem_mudar_etapa(p_ordem, 'em_manutencao', 'etapa', jsonb_build_object('tecnico', v_nome));
  return jsonb_build_object('numero', v_o.numero, 'etapa', 'em_manutencao');
end
$func$;
revoke all on function public.sat_ordem_iniciar_manutencao(uuid) from public, anon;
grant execute on function public.sat_ordem_iniciar_manutencao(uuid) to authenticated, service_role;

-- Defeito da lista (ativo) + solução em texto. O mesmo defeito não entra duas vezes na manutenção da OS.
create or replace function public.sat_ordem_defeito_adicionar(p_ordem uuid, p_defeito uuid, p_solucao text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o    sat_ordens;
  v_desc text;
  v_sol  text := btrim(coalesce(p_solucao, ''));
  v_id   uuid;
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  select d.descricao into v_desc from sat_defeitos d where d.id = p_defeito and d.ativo;
  if v_desc is null then raise exception 'DEFEITO_INVALIDO'; end if;
  if v_sol = '' then raise exception 'SOLUCAO_OBRIGATORIA'; end if;
  if length(v_sol) > 2000 then raise exception 'TEXTO_LONGO'; end if;
  if exists (select 1 from sat_ordem_defeitos x
              where x.ordem_id = p_ordem and x.defeito_id = p_defeito and x.origem = 'manutencao') then
    raise exception 'DEFEITO_REPETIDO';
  end if;
  insert into sat_ordem_defeitos (ordem_id, defeito_id, defeito_descricao, origem, solucao, usuario, usuario_nome)
  values (p_ordem, p_defeito, v_desc, 'manutencao', v_sol, auth.uid(), sat__nome_usuario())
  returning id into v_id;
  perform sat__ordem_evento(p_ordem, 'defeito', jsonb_build_object('acao', 'incluido', 'defeito', v_desc, 'solucao', v_sol));
  return v_id;
end
$func$;
revoke all on function public.sat_ordem_defeito_adicionar(uuid, uuid, text) from public, anon;
grant execute on function public.sat_ordem_defeito_adicionar(uuid, uuid, text) to authenticated, service_role;

create or replace function public.sat_ordem_defeito_remover(p_item uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_x sat_ordem_defeitos;
  v_o sat_ordens;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_x from sat_ordem_defeitos x where x.id = p_item and x.origem = 'manutencao';
  if not found then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  v_o := sat__ordem_para_manutencao(v_x.ordem_id);   -- trava a OS; quem decide é o delete (remoção concorrente)
  delete from sat_ordem_defeitos where id = p_item and origem = 'manutencao' returning * into v_x;
  if not found then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  perform sat__ordem_evento(v_x.ordem_id, 'defeito',
    jsonb_build_object('acao', 'removido', 'defeito', v_x.defeito_descricao, 'solucao', v_x.solucao));
end
$func$;
revoke all on function public.sat_ordem_defeito_remover(uuid) from public, anon;
grant execute on function public.sat_ordem_defeito_remover(uuid) to authenticated, service_role;

-- Peça trocada: código do item do Compels (maiúsculo), descrição e quantidade. Mesmo código não entra duas vezes
-- (remove e lança de novo com a quantidade certa).
create or replace function public.sat_ordem_peca_adicionar(p_ordem uuid, p_codigo text, p_descricao text, p_quantidade numeric)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o      sat_ordens;
  v_codigo text := upper(btrim(coalesce(p_codigo, '')));
  v_desc   text := btrim(coalesce(p_descricao, ''));
  v_id     uuid;
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if v_codigo !~ '^[A-Z0-9][A-Z0-9_.-]{0,59}$' then raise exception 'CODIGO_INVALIDO'; end if;
  if length(v_desc) > 300 then raise exception 'TEXTO_LONGO'; end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > 9999 then raise exception 'QUANTIDADE_INVALIDA'; end if;
  if exists (select 1 from sat_ordem_pecas x where x.ordem_id = p_ordem and x.codigo = v_codigo and x.situacao = 'trocada') then
    raise exception 'PECA_REPETIDA';
  end if;
  insert into sat_ordem_pecas (ordem_id, codigo, descricao, quantidade, usuario, usuario_nome)
  values (p_ordem, v_codigo, v_desc, p_quantidade, auth.uid(), sat__nome_usuario())
  returning id into v_id;
  perform sat__ordem_evento(p_ordem, 'peca',
    jsonb_build_object('acao', 'incluida', 'codigo', v_codigo, 'descricao', v_desc, 'quantidade', p_quantidade));
  return v_id;
end
$func$;
revoke all on function public.sat_ordem_peca_adicionar(uuid, text, text, numeric) from public, anon;
grant execute on function public.sat_ordem_peca_adicionar(uuid, text, text, numeric) to authenticated, service_role;

create or replace function public.sat_ordem_peca_remover(p_item uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_x sat_ordem_pecas;
  v_o sat_ordens;
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  select * into v_x from sat_ordem_pecas x where x.id = p_item;
  if not found then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  v_o := sat__ordem_para_manutencao(v_x.ordem_id);   -- trava a OS; quem decide é o delete (remoção concorrente)
  delete from sat_ordem_pecas where id = p_item returning * into v_x;
  if not found then raise exception 'ITEM_NAO_ENCONTRADO'; end if;
  perform sat__ordem_evento(v_x.ordem_id, 'peca',
    jsonb_build_object('acao', 'removida', 'codigo', v_x.codigo, 'descricao', v_x.descricao, 'quantidade', v_x.quantidade));
end
$func$;
revoke all on function public.sat_ordem_peca_remover(uuid) from public, anon;
grant execute on function public.sat_ordem_peca_remover(uuid) to authenticated, service_role;

-- Laudo (até 4000). Texto igual ao gravado não grava nada.
create or replace function public.sat_ordem_laudo_salvar(p_ordem uuid, p_laudo text)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o     sat_ordens;
  v_laudo text := btrim(coalesce(p_laudo, ''));
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if length(v_laudo) > 4000 then raise exception 'TEXTO_LONGO'; end if;
  if v_laudo = v_o.laudo then return; end if;
  update sat_ordens set laudo = v_laudo, atualizado_em = now() where id = p_ordem;
  perform sat__ordem_evento(p_ordem, 'laudo', jsonb_build_object('laudo', v_laudo));
end
$func$;
revoke all on function public.sat_ordem_laudo_salvar(uuid, text) from public, anon;
grant execute on function public.sat_ordem_laudo_salvar(uuid, text) to authenticated, service_role;

-- Troca de NS: p = {ns, modelo, sequencia} (o par já normalizado pelo app, como na entrada). O antigo fica em
-- sat_ordem_ns e a busca acha a OS pelos dois.
create or replace function public.sat_ordem_trocar_ns(p_ordem uuid, p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o   sat_ordens;
  v_ns  text := btrim(coalesce(p->>'ns', ''));
  v_mod text := nullif(btrim(coalesce(p->>'modelo', '')), '');
  v_seq text := nullif(btrim(coalesce(p->>'sequencia', '')), '');
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if v_ns = '' then raise exception 'NS_OBRIGATORIO'; end if;
  if length(v_ns) > 200 then raise exception 'TEXTO_LONGO'; end if;
  if upper(v_ns) = upper(v_o.ns_atual)
     or (v_seq is not null and v_seq = v_o.sequencia and v_mod is not distinct from v_o.modelo) then
    raise exception 'NADA_A_MUDAR';
  end if;
  insert into sat_ordem_ns (ordem_id, ns_antigo, modelo_antigo, sequencia_antigo, ns_novo, modelo_novo, sequencia_novo,
                            usuario, usuario_nome)
  values (p_ordem, v_o.ns_atual, v_o.modelo, v_o.sequencia, v_ns, v_mod, v_seq, auth.uid(), sat__nome_usuario());
  update sat_ordens set ns_atual = v_ns, modelo = v_mod, sequencia = v_seq, atualizado_em = now() where id = p_ordem;
  perform sat__ordem_evento(p_ordem, 'ns', jsonb_build_object('ns_antigo', v_o.ns_atual, 'ns_novo', v_ns));
  return jsonb_build_object('ns_antigo', v_o.ns_atual, 'ns_novo', v_ns);
end
$func$;
revoke all on function public.sat_ordem_trocar_ns(uuid, jsonb) from public, anon;
grant execute on function public.sat_ordem_trocar_ns(uuid, jsonb) to authenticated, service_role;

-- Em manutenção → qualidade. Nesta entrega só EM GARANTIA (fora da garantia passa pelo orçamento, entrega 2).
create or replace function public.sat_ordem_enviar_qualidade(p_ordem uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_o        sat_ordens;
  v_defeitos int;
  v_pecas    int;
begin
  v_o := sat__ordem_para_manutencao(p_ordem);
  if v_o.tipo is null then raise exception 'GARANTIA_INDEFINIDA'; end if;
  if v_o.tipo <> 'em_garantia' then raise exception 'FORA_DA_GARANTIA'; end if;
  select count(*) into v_defeitos from sat_ordem_defeitos x where x.ordem_id = p_ordem and x.origem = 'manutencao';
  if v_defeitos = 0 then raise exception 'SEM_DEFEITO'; end if;
  if btrim(v_o.laudo) = '' then raise exception 'SEM_LAUDO'; end if;
  select count(*) into v_pecas from sat_ordem_pecas x where x.ordem_id = p_ordem and x.situacao = 'trocada';
  perform sat__ordem_mudar_etapa(p_ordem, 'qualidade', 'etapa',
    jsonb_build_object('defeitos', v_defeitos, 'pecas', v_pecas));
  return jsonb_build_object('numero', v_o.numero, 'etapa', 'qualidade');
end
$func$;
revoke all on function public.sat_ordem_enviar_qualidade(uuid) from public, anon;
grant execute on function public.sat_ordem_enviar_qualidade(uuid) to authenticated, service_role;

-- =============================================================
-- PARTE D — correção de etapa, busca por NS, leituras de apoio e cache do Compels
-- =============================================================

-- ---------- correção de etapa pelo administrador (sat.administrar), com motivo no histórico ----------
create or replace function public.sat_ordem_corrigir_etapa(p_ordem uuid, p_etapa text, p_motivo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
declare
  v_motivo text := regexp_replace(btrim(coalesce(p_motivo, '')), '\s+', ' ', 'g');
  v_de     text;
begin
  if not tem_permissao('sat', 'administrar') then raise exception 'SEM_PERMISSAO'; end if;
  if p_etapa is null or p_etapa not in ('recebido', 'nota_pendente', 'disponivel', 'em_manutencao', 'qualidade') then
    raise exception 'ETAPA_INVALIDA';
  end if;
  if length(v_motivo) < 3 or length(v_motivo) > 500 then raise exception 'MOTIVO_CORRECAO_OBRIGATORIO'; end if;
  select o.etapa into v_de from sat_ordens o where o.id = p_ordem;
  if not found then raise exception 'ORDEM_NAO_ENCONTRADA'; end if;
  perform sat__ordem_mudar_etapa(p_ordem, p_etapa, 'correcao_etapa', jsonb_build_object('motivo', v_motivo));
  return jsonb_build_object('etapa_de', v_de, 'etapa_para', p_etapa);
end
$func$;
revoke all on function public.sat_ordem_corrigir_etapa(uuid, text, text) from public, anon;
grant execute on function public.sat_ordem_corrigir_etapa(uuid, text, text) to authenticated, service_role;

-- ---------- busca por NS: atual, antigo ou novo (invoker: o RLS de sat.visualizar vale) ----------
-- Sem modelo, casa só pela sequência (como a busca da entrada).
create or replace function public.sat_ordens_do_ns(p_modelo text, p_sequencia text)
returns setof uuid
language sql
stable
set search_path = public
as $func$
  select o.id from sat_ordens o
   where coalesce(p_sequencia, '') <> '' and o.sequencia = p_sequencia
     and (coalesce(p_modelo, '') = '' or o.modelo = p_modelo)
  union
  select n.ordem_id from sat_ordem_ns n
   where coalesce(p_sequencia, '') <> ''
     and ((n.sequencia_antigo = p_sequencia and (coalesce(p_modelo, '') = '' or n.modelo_antigo = p_modelo))
       or (n.sequencia_novo = p_sequencia and (coalesce(p_modelo, '') = '' or n.modelo_novo = p_modelo)))
$func$;
revoke all on function public.sat_ordens_do_ns(text, text) from public, anon;
grant execute on function public.sat_ordens_do_ns(text, text) to authenticated, service_role;

-- ---------- camada 1 da lista de peças: as mais trocadas neste produto (invoker) ----------
create or replace function public.sat_pecas_mais_usadas(p_produto text, p_limite int)
returns table (codigo text, descricao text, usos bigint)
language sql
stable
set search_path = public
as $func$
  select p.codigo, (array_agg(p.descricao order by p.em desc))[1], count(*)
    from sat_ordem_pecas p
    join sat_ordens o on o.id = p.ordem_id
   where p.situacao = 'trocada'
     and coalesce(btrim(p_produto), '') <> ''
     and upper(btrim(o.produto)) = upper(btrim(p_produto))
   group by p.codigo
   order by count(*) desc, p.codigo
   limit least(greatest(coalesce(p_limite, 15), 1), 50)
$func$;
revoke all on function public.sat_pecas_mais_usadas(text, int) from public, anon;
grant execute on function public.sat_pecas_mais_usadas(text, int) to authenticated, service_role;

-- ---------- candidatos da camada 2: kits (PMOE*) já usados em alguma OS (invoker) ----------
create or replace function public.sat_kits_conhecidos()
returns table (codigo text, descricao text)
language sql
stable
set search_path = public
as $func$
  select p.codigo, (array_agg(p.descricao order by p.em desc))[1]
    from sat_ordem_pecas p
   where p.codigo like 'PMOE%'
   group by p.codigo
   order by p.codigo
   limit 200
$func$;
revoke all on function public.sat_kits_conhecidos() from public, anon;
grant execute on function public.sat_kits_conhecidos() to authenticated, service_role;

-- ---------- cache das leituras do Compels (estrutura do produto, pais de item); validade no app (7 dias) ----------
create table if not exists public.sat_compels_cache (
  chave   text primary key,
  dados   jsonb not null,
  lido_em timestamptz not null default now()
);
alter table public.sat_compels_cache enable row level security;
drop policy if exists sat_compels_cache_select on public.sat_compels_cache;
create policy sat_compels_cache_select on public.sat_compels_cache
  for select using ((select tem_permissao('sat', 'visualizar')));
revoke all on public.sat_compels_cache from public, anon, authenticated;
grant select on public.sat_compels_cache to authenticated;
grant select, insert, update, delete on public.sat_compels_cache to service_role;

create or replace function public.sat_compels_cache_gravar(p_chave text, p_dados jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $func$
#variable_conflict use_column
begin
  if not tem_permissao('sat', 'manutencao') then raise exception 'SEM_PERMISSAO'; end if;
  if p_chave is null or p_chave !~ '^(estrutura:[A-Z0-9][A-Z0-9_.-]{0,59}|pais:[0-9]{1,18})$' then
    raise exception 'CHAVE_INVALIDA';
  end if;
  if p_dados is null or octet_length(p_dados::text) > 2000000 then raise exception 'CACHE_GRANDE'; end if;
  insert into sat_compels_cache as c (chave, dados, lido_em) values (p_chave, p_dados, now())
  on conflict (chave) do update set dados = excluded.dados, lido_em = excluded.lido_em;
end
$func$;
revoke all on function public.sat_compels_cache_gravar(text, jsonb) from public, anon;
grant execute on function public.sat_compels_cache_gravar(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
