-- =============================================================
-- ShopFloor Processo — Fundação de dados
-- Tabelas: sf_postos, sf_defeitos, sf_ordens, sf_ordem_postos, sf_registros.
-- + permissão `lancar` (operador de produção). SEM dados de OP/defeito aqui
-- (a migração de dados da planilha é um script à parte).
-- =============================================================

-- ---------- Permissão nova: lancar ----------
alter table public.perfis add column pode_lancar boolean not null default false;

create or replace function public.tem_permissao(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case perm
      when 'visualizar'         then p.pode_visualizar
      when 'importar'           then p.pode_importar
      when 'editar'             then p.pode_editar
      when 'finalizar'          then p.pode_finalizar
      when 'editar_finalizado'  then p.pode_editar_finalizado
      when 'excluir'            then p.pode_excluir
      when 'gerar_etiqueta'     then p.pode_gerar_etiqueta
      when 'administrar'        then p.pode_administrar
      when 'lancar'             then p.pode_lancar
      else false
    end
    from public.usuarios u
    join public.perfis p on p.id = u.perfil_id
    where u.id = auth.uid() and u.ativo
  ), false);
$$;

-- Admin e Supervisor ganham lancar; novo perfil de sistema "Produção" (visualizar + lancar).
update public.perfis set pode_lancar = true where nome in ('Administrador', 'Supervisor');
insert into public.perfis (nome, pode_visualizar, pode_lancar, sistema)
values ('Produção', true, true, true)
on conflict (nome) do nothing;

-- ---------- Catálogo de postos ----------
create table public.sf_postos (
  chave text primary key,          -- ex.: 'Inicial'
  ordem int not null,              -- posição no fluxo
  created_at timestamptz not null default now()
);
alter table public.sf_postos enable row level security;
create policy sf_postos_select on public.sf_postos for select using (tem_permissao('visualizar'));

insert into public.sf_postos (chave, ordem) values
  ('Inicial', 1), ('Inspeção SPI', 2), ('Inspeção SMD', 3), ('Montagem PTH', 4),
  ('Inspeção PTH', 5), ('Teste', 6), ('Integração', 7), ('Teste Final', 8),
  ('Inspeção Final', 9), ('Embalagem', 10), ('Inspeção NQA', 11), ('Manutenção', 12);

-- ---------- Catálogo de defeitos ----------
create table public.sf_defeitos (
  codigo text primary key,         -- ex.: '1002 TRILHA ROMPIDA'
  tipo smallint not null,          -- 1 (peça) | 2 (teste)
  created_at timestamptz not null default now()
);
alter table public.sf_defeitos enable row level security;
create policy sf_defeitos_select on public.sf_defeitos for select using (tem_permissao('visualizar'));
create policy sf_defeitos_admin  on public.sf_defeitos for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- Ordens (PMO/OP) ----------
create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  cliente text not null,
  qtd int,
  descricao text not null default '',
  acp text not null default '',
  status text not null default '',
  sn_ini text not null default '',
  sn_fim text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pmo, op)
);
alter table public.sf_ordens enable row level security;
create policy sf_ordens_select on public.sf_ordens for select using (tem_permissao('visualizar'));
create policy sf_ordens_admin  on public.sf_ordens for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- Aplicabilidade de postos por ordem ----------
create table public.sf_ordem_postos (
  ordem_id uuid not null references public.sf_ordens(id) on delete cascade,
  posto text not null references public.sf_postos(chave),
  primary key (ordem_id, posto)
);
alter table public.sf_ordem_postos enable row level security;
create policy sf_ordem_postos_select on public.sf_ordem_postos for select using (tem_permissao('visualizar'));
create policy sf_ordem_postos_admin  on public.sf_ordem_postos for all using (tem_permissao('administrar')) with check (tem_permissao('administrar'));

-- ---------- Registros (o coração: SN × posto) ----------
create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  colaborador text not null default '',
  posto text not null,
  pmo text not null,
  op text not null,
  cliente text not null default '',
  numero_caixa text not null default '',
  qtd_por_caixa int,
  status text not null default '',
  numero_serie text not null default '',
  numero_serie_norm text not null default '',   -- normalizado p/ comparação/duplicidade
  codigo_defeito text not null default '',
  posicao text not null default '',
  tipo_defeito text not null default '',
  nqa_visual text not null default '',
  nqa_funcional text not null default '',
  created_at timestamptz not null default now()
);
alter table public.sf_registros enable row level security;
create policy sf_registros_select on public.sf_registros for select using (tem_permissao('visualizar'));
create policy sf_registros_insert on public.sf_registros for insert with check (tem_permissao('lancar'));
-- registro é imutável na fase 1 (sem update/delete via app).

create index sf_registros_ordem_sn on public.sf_registros (pmo, op, numero_serie_norm);
create index sf_registros_caixa    on public.sf_registros (pmo, op, posto, numero_caixa);
