create table public.configuracao_campos (
  id uuid primary key default gen_random_uuid(),
  campo text not null unique,
  rotulo text not null,
  grupo text not null check (grupo in ('comercial','material','recebimento','qualidade')),
  tipo text not null default 'texto' check (tipo in ('texto','lista','numero','data')),
  lista_chave text references public.listas(chave),
  origem text not null check (origem in ('comercial','recebimento')),
  obrigatorio_importacao boolean not null default false,
  obrigatorio_finalizacao boolean not null default false,
  ordem int not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- campo, rotulo, grupo, tipo, lista_chave, origem, obrig_imp, obrig_fin, ordem
insert into public.configuracao_campos
  (campo, rotulo, grupo, tipo, lista_chave, origem, obrigatorio_importacao, obrigatorio_finalizacao, ordem) values
  -- Comercial
  ('numero_nf',          'Nº NF',              'comercial', 'texto',  null,          'comercial', false, true,  10),
  ('numero_emb',         'Nº EMB',             'comercial', 'texto',  null,          'comercial', false, false, 20),
  ('di_inpi',            'Nº DI/INPI',         'comercial', 'texto',  null,          'comercial', false, false, 30),
  ('acp_cliente',        'ACP/Cliente',        'comercial', 'texto',  null,          'comercial', false, false, 40),
  ('numero_pedido',      'Nº Pedido',          'comercial', 'texto',  null,          'comercial', true,  true,  50),
  ('data_chegada',       'Data Chegada',       'comercial', 'data',   null,          'comercial', false, true,  60),
  ('data_compra',        'Data Compra',        'comercial', 'data',   null,          'comercial', false, false, 70),
  ('data_prevista',      'Data Prevista',      'comercial', 'data',   null,          'comercial', false, false, 80),
  ('atraso',             'Atraso',             'comercial', 'lista',  'atraso',      'comercial', false, false, 90),
  ('tipo',               'Tipo',               'comercial', 'lista',  'tipo',        'comercial', false, false, 100),
  ('comprador',          'Comprador',          'comercial', 'lista',  'comprador',   'comercial', false, false, 110),
  ('fornecedor',         'Fornecedor',         'comercial', 'lista',  'fornecedor',  'comercial', false, true,  120),
  ('critico',            'Crítico?',           'comercial', 'lista',  'critico',     'comercial', false, false, 130),
  -- Material
  ('codigo_material',    'Código do Material', 'material',  'texto',  null,          'comercial', true,  true,  140),
  ('descricao_material', 'Descrição do Material','material','texto',  null,          'comercial', true,  true,  150),
  ('quantidade_pedido',  'Quantidade no Pedido','material', 'numero', null,          'comercial', true,  true,  160),
  -- Recebimento
  ('quantidade_recebida','Quantidade Recebida','recebimento','numero',null,          'recebimento', false, true, 170),
  ('volumes',            'Volumes',            'recebimento','numero',null,          'recebimento', false, true, 180),
  ('divergencia',        'Divergência',        'recebimento','lista', 'divergencia', 'recebimento', false, false, 190),
  ('responsavel_contagem','Responsável Contagem','recebimento','texto',null,         'recebimento', false, false, 200),
  ('tipo_entrega',       'Tipo de Entrega',    'recebimento','lista', 'tipo_entrega','recebimento', false, false, 210),
  ('amostral',           'Amostral',           'recebimento','lista', 'amostral',    'recebimento', false, false, 220),
  ('part_number_recebido','Part Number Recebido','recebimento','texto',null,         'recebimento', false, false, 230),
  -- Qualidade
  ('inscricoes',         'Inscrições',         'qualidade', 'texto',  null,          'recebimento', false, false, 240),
  ('fabricante',         'Fabricante',         'qualidade', 'texto',  null,          'recebimento', false, false, 250),
  ('medida_eletrica',    'Medida Elétrica',    'qualidade', 'texto',  null,          'recebimento', false, false, 260),
  ('coloracao',          'Coloração',          'qualidade', 'texto',  null,          'recebimento', false, false, 270),
  ('dimensional',        'Dimensional',        'qualidade', 'texto',  null,          'recebimento', false, false, 280),
  ('impressoes',         'Impressões',         'qualidade', 'texto',  null,          'recebimento', false, false, 290),
  ('data_validade',      'Data de Validade',   'qualidade', 'data',   null,          'recebimento', false, false, 300),
  ('revisao',            'Revisão',            'qualidade', 'texto',  null,          'recebimento', false, false, 310),
  ('material',           'Material',           'qualidade', 'texto',  null,          'recebimento', false, false, 320),
  ('resultado',          'Resultado',          'qualidade', 'lista',  'resultado',   'recebimento', false, true,  330),
  ('quantidade_reprovada','Quantidade Reprovada','qualidade','numero',null,          'recebimento', false, false, 340),
  ('motivo_reprovacao',  'Motivo da Reprovação','qualidade','texto',  null,          'recebimento', false, false, 350),
  ('rnc',                'RNC',                'qualidade', 'texto',  null,          'recebimento', false, false, 360),
  ('rac',                'RAC',                'qualidade', 'texto',  null,          'recebimento', false, false, 370),
  ('observacao',         'Observação',         'qualidade', 'texto',  null,          'recebimento', false, false, 380);

alter table public.configuracao_campos enable row level security;
create policy config_campos_select on public.configuracao_campos
  for select to authenticated using (true);
create policy config_campos_write on public.configuracao_campos
  for all to authenticated
  using (public.tem_permissao('administrar'))
  with check (public.tem_permissao('administrar'));
