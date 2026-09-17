-- =============================================================
-- Módulo Setup — tabelas (spec 2026-09-16-modulo-setup-abastecimento-design.md).
-- Leitura: quem visualiza o módulo. Escrita de operação: só pelas funções st_* (0112, security
-- definer). Cadastros (equipamentos, estrutura) são escritos direto pelo app, restritos a administrar.
-- No PTH, posicao/feeder guardam posto/locação.
-- =============================================================

create table public.st_equipamentos (
  id          uuid primary key default gen_random_uuid(),
  processo    text not null check (processo in ('SMD', 'PTH')),
  linha       text not null,
  equipamento text not null,                -- máquina (SMD) ou bloco (PTH)
  posicoes    int check (posicoes is null or posicoes > 0),
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now(),
  unique (processo, linha, equipamento)
);

create table public.st_estrutura (
  pmo        text not null,
  componente text not null,                 -- código do ERP (prefixo do rolo), maiúsculas
  processo   text not null check (processo in ('SMD', 'PTH')),
  origem     text not null default 'manual' check (origem in ('importacao', 'manual')),
  criado_por uuid references public.usuarios(id),
  criado_em  timestamptz not null default now(),
  primary key (pmo, componente)
);

create table public.st_setups (
  id           uuid primary key default gen_random_uuid(),
  pmo          text not null,
  op           text not null,
  processo     text not null check (processo in ('SMD', 'PTH')),
  linha        text not null,
  equipamento  text not null,
  face         text not null check (face in ('TOP', 'BOT', 'TOP E BOT')),
  sn_abertura  text not null,
  estado       text not null default 'montagem' check (estado in ('montagem', 'liberado')),
  copiado_de   uuid references public.st_setups(id) on delete set null,
  criado_por   uuid references public.usuarios(id),
  criado_em    timestamptz not null default now(),
  liberado_por uuid references public.usuarios(id),
  liberado_em  timestamptz,
  unique (pmo, op, processo, linha, equipamento, face)
);
create index st_setups_pmo_op on public.st_setups (pmo, op);

create table public.st_setup_itens (
  id             uuid primary key default gen_random_uuid(),
  setup_id       uuid not null references public.st_setups(id) on delete cascade,
  processo       text not null check (processo in ('SMD', 'PTH')),   -- cópia do setup (índices parciais)
  posicao        text not null,              -- posição (SMD) ou posto (PTH)
  feeder         text not null,              -- feeder (SMD) ou locação (PTH)
  componente     text not null,
  rolo           text,                       -- rolo montado agora (código completo); null = falta bipar
  atualizado_por uuid references public.usuarios(id),
  atualizado_em  timestamptz not null default now(),
  unique (setup_id, posicao, feeder)
);
create unique index st_itens_posicao_smd on public.st_setup_itens (setup_id, posicao) where processo = 'SMD';
create unique index st_itens_feeder_smd  on public.st_setup_itens (setup_id, feeder)  where processo = 'SMD';
create unique index st_itens_rolo        on public.st_setup_itens (setup_id, rolo)    where rolo is not null;

create table public.st_trocas (
  id            uuid primary key default gen_random_uuid(),
  setup_id      uuid not null references public.st_setups(id) on delete cascade,
  item_id       uuid references public.st_setup_itens(id) on delete set null,
  posicao       text not null,
  feeder        text not null,
  rolo_saida    text not null,
  rolo_entrada  text not null,
  sn_inicial    text not null,
  resultado     text not null check (resultado in ('APROVADO', 'REPROVADO')),
  motivos       text[] not null default '{}',
  operador      uuid references public.usuarios(id),
  operador_nome text not null default '',
  data_hora     timestamptz not null default now()
);
create index st_trocas_setup_data on public.st_trocas (setup_id, data_hora desc);
create index st_trocas_data on public.st_trocas (data_hora desc);

create table public.st_alteracoes (
  id           uuid primary key default gen_random_uuid(),
  setup_id     uuid not null references public.st_setups(id) on delete cascade,
  item_id      uuid,
  tipo         text not null check (tipo in ('troca_feeder', 'troca_posicao', 'correcao', 'inclusao', 'remocao')),
  antes        jsonb,
  depois       jsonb,
  usuario      uuid references public.usuarios(id),
  usuario_nome text not null default '',
  data_hora    timestamptz not null default now()
);
create index st_alteracoes_setup on public.st_alteracoes (setup_id, data_hora desc);

-- ---------- RLS ----------
alter table public.st_equipamentos enable row level security;
alter table public.st_estrutura    enable row level security;
alter table public.st_setups       enable row level security;
alter table public.st_setup_itens  enable row level security;
alter table public.st_trocas       enable row level security;
alter table public.st_alteracoes   enable row level security;

create policy st_equipamentos_select on public.st_equipamentos for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_equipamentos_admin  on public.st_equipamentos for all using ((select tem_permissao('setup', 'administrar'))) with check ((select tem_permissao('setup', 'administrar')));
create policy st_estrutura_select    on public.st_estrutura    for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_estrutura_admin     on public.st_estrutura    for all using ((select tem_permissao('setup', 'administrar'))) with check ((select tem_permissao('setup', 'administrar')));
create policy st_setups_select       on public.st_setups       for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_setup_itens_select  on public.st_setup_itens  for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_trocas_select       on public.st_trocas       for select using ((select tem_permissao('setup', 'visualizar')));
create policy st_alteracoes_select   on public.st_alteracoes   for select using ((select tem_permissao('setup', 'visualizar')));

-- ---------- GRANTs (no RDS da AWS os privilégios padrão podem não valer pra tabela nova) ----------
grant select on public.st_setups, public.st_setup_itens, public.st_trocas, public.st_alteracoes to authenticated;
grant select, insert, update, delete on public.st_equipamentos, public.st_estrutura to authenticated;
grant select, insert, update, delete on public.st_equipamentos, public.st_estrutura, public.st_setups,
  public.st_setup_itens, public.st_trocas, public.st_alteracoes to service_role;

-- ---------- Equipamentos de hoje (planilha legada) ----------
insert into public.st_equipamentos (processo, linha, equipamento, posicoes) values
  ('SMD', '1', 'YSM10', null),
  ('SMD', '1', 'MG5', null),
  ('SMD', '2', 'YSM10', 148),
  ('SMD', '3', 'CP40', null)
on conflict do nothing;
insert into public.st_equipamentos (processo, linha, equipamento)
select 'PTH', l::text, b
from generate_series(1, 6) as l, unnest(array['A', 'B']) as b
on conflict do nothing;

notify pgrst, 'reload schema';
