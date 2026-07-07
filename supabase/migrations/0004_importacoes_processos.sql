-- trigger utilitário de updated_at
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

-- ============ IMPORTACOES ============
create table public.importacoes (
  id uuid primary key default gen_random_uuid(),
  arquivo_nome text not null,
  formato text not null check (formato in ('xlsx','csv')),
  total_linhas int not null default 0,
  total_processos_criados int not null default 0,
  mapeamento jsonb not null default '{}'::jsonb,
  usuario_id uuid references public.usuarios(id),
  created_at timestamptz not null default now()
);

-- ============ PROCESSOS ============
create sequence public.processos_numero_seq;

create table public.processos_recebimento (
  id uuid primary key default gen_random_uuid(),
  numero bigint not null default nextval('public.processos_numero_seq') unique,
  importacao_id uuid references public.importacoes(id),
  status text not null default 'aberto'
    check (status in ('aberto','em_conferencia','finalizado','cancelado')),
  -- comercial
  numero_nf text, numero_emb text, di_inpi text, acp_cliente text, numero_pedido text,
  data_chegada date, data_compra date, data_prevista date,
  atraso text, tipo text, comprador text, fornecedor text, critico text,
  -- material
  codigo_material text, descricao_material text, quantidade_pedido numeric,
  -- recebimento
  quantidade_recebida numeric, volumes integer, divergencia text,
  responsavel_contagem text, tipo_entrega text, amostral text, part_number_recebido text,
  -- qualidade
  inscricoes text, fabricante text, medida_eletrica text, coloracao text,
  dimensional text, impressoes text, data_validade date, revisao text, material text,
  resultado text, quantidade_reprovada numeric, motivo_reprovacao text,
  rnc text, rac text, observacao text,
  -- auditoria
  criado_por uuid references public.usuarios(id),
  atualizado_por uuid references public.usuarios(id),
  finalizado_por uuid references public.usuarios(id),
  finalizado_em timestamptz,
  cancelado_por uuid references public.usuarios(id),
  motivo_cancelamento text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index processos_status_idx on public.processos_recebimento(status);
create index processos_importacao_idx on public.processos_recebimento(importacao_id);

create trigger processos_updated_at
  before update on public.processos_recebimento
  for each row execute function public.set_updated_at();

-- ============ RLS ============
alter table public.importacoes enable row level security;
alter table public.processos_recebimento enable row level security;

create policy importacoes_select on public.importacoes
  for select to authenticated using (public.tem_permissao('visualizar'));
create policy importacoes_insert on public.importacoes
  for insert to authenticated with check (public.tem_permissao('importar'));

create policy processos_select on public.processos_recebimento
  for select to authenticated using (public.tem_permissao('visualizar'));

create policy processos_insert on public.processos_recebimento
  for insert to authenticated with check (public.tem_permissao('importar') or public.tem_permissao('editar'));

-- update: precisa de 'editar'; se o registro está finalizado, precisa de 'editar_finalizado'
create policy processos_update on public.processos_recebimento
  for update to authenticated
  using (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  )
  with check (
    public.tem_permissao('editar')
    and (status <> 'finalizado' or public.tem_permissao('editar_finalizado'))
  );

create policy processos_delete on public.processos_recebimento
  for delete to authenticated using (public.tem_permissao('excluir'));
