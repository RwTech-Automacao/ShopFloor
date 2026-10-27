-- Esquema mínimo para provar a 0164 (Dashboard e Fluxo em placas) sem subir o banco inteiro.
-- Só o que a 0090, 0093, 0105, 0157 e 0161 leem. Roda ANTES delas.
create role anon;
create role authenticated;
create role service_role bypassrls;

-- tem_permissao (0001/0038): aqui sempre verdadeiro — o teste prova a CONTA, não o RBAC.
create function public.tem_permissao(p text) returns boolean language sql stable as $f$ select true $f$;

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  qtd int,
  status text not null default 'ATIVA',
  cliente text not null default '',
  descricao text not null default '',
  unique (pmo, op)
);

create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null,
  ordem int not null default 0,
  primary key (ordem_id, posto)
);

create table public.sf_registros (
  id bigint generated always as identity primary key,
  data_hora timestamptz not null default now(),
  created_at timestamptz not null default now(),
  pmo text not null,
  op text not null,
  posto text not null,
  status text not null default '',
  numero_serie_norm text not null default '',
  colaborador text not null default '',
  codigo_defeito text not null default '',
  tipo_defeito text not null default '',
  posicao text not null default '',
  posto_retorno text
);

create table public.sf_posto_perfis (chave text primary key, recurso text not null default 'nenhum');
create table public.sf_postos (chave text primary key, perfil text references public.sf_posto_perfis(chave));
insert into public.sf_posto_perfis values ('passagem', 'nenhum'), ('teste', 'nenhum'), ('burnin', 'burnin');
insert into public.sf_postos values ('MONT', 'passagem'), ('TESTE', 'teste'), ('BURN', 'burnin');

grant select, insert, update, delete on public.sf_ordens, public.sf_ordem_postos, public.sf_registros
  to authenticated, service_role;
