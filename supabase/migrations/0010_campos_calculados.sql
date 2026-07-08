-- 1) configuracao_campos: metadados de cálculo
alter table public.configuracao_campos
  add column calculado boolean not null default false,
  add column formula text check (formula in
    ('diferenca_dias','diferenca_numerica','lookup_fornecedor_critico','tabela_nqa','usuario_primeiro')),
  add column formula_config jsonb not null default '{}'::jsonb;

update public.configuracao_campos set calculado=true, formula='diferenca_dias',
  formula_config='{"a":"data_chegada","b":"data_prevista"}'::jsonb where campo='atraso';
update public.configuracao_campos set calculado=true, formula='diferenca_numerica',
  formula_config='{"a":"quantidade_recebida","b":"quantidade_pedido"}'::jsonb where campo='divergencia';
update public.configuracao_campos set calculado=true, formula='lookup_fornecedor_critico',
  formula_config='{"campo":"fornecedor"}'::jsonb where campo='critico';
update public.configuracao_campos set calculado=true, formula='tabela_nqa',
  formula_config='{"campo":"quantidade_recebida"}'::jsonb where campo='amostral';
update public.configuracao_campos set calculado=true, formula='usuario_primeiro',
  formula_config='{}'::jsonb where campo='responsavel_contagem';

-- 2) Criticidade por Fornecedor
create table public.criticidade_fornecedor (
  id uuid primary key default gen_random_uuid(),
  fornecedor text not null unique,
  critico text not null,
  created_at timestamptz not null default now()
);
alter table public.criticidade_fornecedor enable row level security;
create policy criticidade_select on public.criticidade_fornecedor
  for select to authenticated using (true);
create policy criticidade_write on public.criticidade_fornecedor
  for all to authenticated using (public.tem_permissao('administrar')) with check (public.tem_permissao('administrar'));

-- 3) Tabela NQA (faixas de quantidade -> tamanho de amostra)
create table public.tabela_nqa (
  id uuid primary key default gen_random_uuid(),
  quantidade_min int not null,
  quantidade_max int,
  tamanho_amostra numeric,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.tabela_nqa enable row level security;
create policy nqa_select on public.tabela_nqa
  for select to authenticated using (true);
create policy nqa_write on public.tabela_nqa
  for all to authenticated using (public.tem_permissao('administrar')) with check (public.tem_permissao('administrar'));

insert into public.tabela_nqa (quantidade_min, quantidade_max, ordem) values
  (0,0,10),(1,1,20),(2,8,30),(9,15,40),(16,25,50),(26,50,60),(51,90,70),(91,150,80),
  (151,280,90),(281,500,100),(501,1200,110),(1201,3200,120),(3201,10000,130),
  (10001,35000,140),(35001,150000,150),(150001,500000,160),(500001,null,170);
