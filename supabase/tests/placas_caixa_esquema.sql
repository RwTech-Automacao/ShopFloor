-- Esquema mínimo para provar a 0163 (caixa e embalagem em placas) com a sf_lancar (0103) e a
create role authenticated;
create role anon;
-- sf_fechar_caixa (0100) REAIS. Só as colunas/tabelas que elas tocam; as migrações 0161 (colunas +
-- trigger) e 0163 vêm do runner.
-- `teste.perms` (2 args) = lista 'modulo.permissao' separada por vírgula (a de DOIS argumentos, de propósito).
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

-- A de UM argumento é a permissão global LEGADA que sf_lancar/sf_fechar_caixa (0100/0103) chamam e
-- que a 0163 preserva. Lê uma lista DIFERENTE (`teste.perms_legado`), pra o teste distinguir qual
-- assinatura a função chama.
create function public.tem_permissao(p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms_legado', true), '') || ',')
         like '%,' || p_perm || ',%'
$f$;

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null,
  op text not null,
  qtd int,
  unique (pmo, op)
);

create table public.sf_registros (
  id uuid primary key default gen_random_uuid(),
  data_hora timestamptz not null default now(),
  created_at timestamptz not null default now(),
  colaborador text not null default '',
  posto text not null default '',
  pmo text not null,
  op text not null,
  cliente text not null default '',
  numero_caixa text not null default '',
  qtd_por_caixa int,
  status text not null default '',
  numero_serie text not null default '',
  numero_serie_norm text not null,
  codigo_defeito text not null default '',
  posicao text not null default '',
  tipo_defeito text not null default '',
  nqa_visual text,
  nqa_funcional text,
  observacao text not null default '',
  posto_retorno text,
  posto_origem text
);

create table public.sf_caixas (
  id         uuid primary key default gen_random_uuid(),
  pmo        text not null,
  op         text not null,
  posto      text not null,
  seq        int  not null,
  limite     int  not null,
  qtd        int  not null default 0,
  codigo     text not null default '',
  fechada    boolean not null default false,
  ultima     boolean not null default false,
  revisao    int  not null default 0,
  created_at timestamptz not null default now(),
  fechada_em timestamptz,
  unique (pmo, op, posto, seq, revisao)
);
