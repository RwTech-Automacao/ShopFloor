-- Esquema mínimo para testar a 0184 sem as 183 migrações anteriores.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create or replace function public.tem_permissao(p_modulo text, p_acao text) returns boolean language sql as 'select true';
create table public.sf_postos (chave text primary key, ordem int not null default 0);
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(), pmo text not null, op text not null,
  placas_por_painel int not null default 1, unique (pmo, op));
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(), data_hora timestamptz not null default now(),
  posto text not null, pmo text not null, op text not null, status text not null default '',
  numero_serie text not null default '', numero_serie_norm text not null default '', pecas int not null default 1,
  created_at timestamptz not null default now());
create table public.sf_estoque_envios (
  id uuid primary key default gen_random_uuid(),
  chave text not null, operacao text not null default 'entrada' check (operacao in ('entrada','estorno')),
  pmo text not null, op text not null, posto text not null,
  tipo text not null check (tipo in ('caixa','serie','lote')),
  bipe text not null, serie_norm text not null default '',
  alvo text generated always as (coalesce(nullif(serie_norm, ''), bipe)) stored,
  quantidade int not null check (quantidade > 0),
  ok boolean not null default false, erro text, tentativas int not null default 0,
  reservado_em timestamptz, enviado_em timestamptz, cancelado_em timestamptz,
  criado_em timestamptz not null default now(),
  estoque text not null default 'PA' check (estoque in ('PA','EINTER')),
  estornado int not null default 0,
  entrada_id uuid references public.sf_estoque_envios (id) on delete restrict,
  adiado_ate timestamptz,
  check (btrim(chave) <> ''),
  check (btrim(bipe) <> ''),
  check (tentativas >= 0),
  check (tipo <> 'serie' or btrim(serie_norm) <> ''),
  check (estornado >= 0 and estornado <= quantidade),
  check ((operacao = 'estorno') = (entrada_id is not null)),
  check (ok = (enviado_em is not null)),
  check (cancelado_em is null or not ok));
create or replace function public.sf_estoque_envios_estoque_do_estorno() returns trigger language plpgsql
set search_path = public as $f$
begin
  if new.operacao = 'estorno' and new.entrada_id is not null then
    select e.estoque into new.estoque from public.sf_estoque_envios e where e.id = new.entrada_id;
    new.estoque := coalesce(new.estoque, 'PA');
  end if;
  return new;
end $f$;
create trigger sf_estoque_envios_estoque_do_estorno before insert on public.sf_estoque_envios
  for each row execute function public.sf_estoque_envios_estoque_do_estorno();
create unique index sf_estoque_envios_chave on public.sf_estoque_envios (chave);
create or replace function public.sf_estoque_chave(
  p_pmo text, p_op text, p_posto text, p_alvo text, p_operacao text
) returns text language sql volatile security definer set search_path = public as $func$
  select 'ALMOX/' || p_pmo || '/' || p_op || '/' || p_posto || '/' || p_alvo || '/'
         || case p_operacao when 'estorno' then 'S' else 'E' end
         || (select count(*) + 1 from public.sf_estoque_envios e
              where e.pmo = p_pmo and e.op = p_op and e.posto = p_posto
                and e.alvo = p_alvo and e.operacao = p_operacao)
$func$;
insert into public.sf_postos (chave, ordem) values
  ('Inspeção AOI TOP', 1), ('Inspeção PTH', 2), ('Teste', 3), ('Almoxarifado', 4);
