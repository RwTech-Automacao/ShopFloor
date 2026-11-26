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
    from (select upper(translate(coalesce(p_garantia, ''),
                                 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as g) x
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
  return lpad(v_n::text, 4, '0') || '/' || lpad((p_ano % 100)::text, 2, '0');
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

notify pgrst, 'reload schema';
