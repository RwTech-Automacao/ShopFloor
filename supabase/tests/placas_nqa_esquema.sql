-- Esquema mínimo para provar a 0166 (NQA de caixa e individual em PLACAS) com as funções REAIS:
-- sf_nqa_individual (0097), sf_nqa_caixa (0130 e depois 0160) e a 0166. Só as colunas/tabelas que
-- elas tocam; a 0161 (colunas `placas_por_painel`/`pecas` + trigger) vem do runner.
-- Runner: supabase/tests/rodar-placas-nqa-test.sh

create role anon; create role authenticated; create role service_role;

-- A de UM argumento é a permissão global LEGADA que as duas RPCs do NQA chamam (`tem_permissao('lancar')`)
-- e que a 0166 preserva. Lê `teste.perms` SEM prefixo de módulo.
create function public.tem_permissao(p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_perm || ',%'
$f$;
-- A de DOIS argumentos lê a mesma lista COM prefixo ('shopfloor.lancar'). O teste dá só 'lancar': se a
-- 0166 trocasse a chamada para a de dois argumentos, as RPCs responderiam SEM_PERMISSAO.
create function public.tem_permissao(p_modulo text, p_perm text) returns boolean language sql stable as $f$
  select (',' || coalesce(current_setting('teste.perms', true), '') || ',')
         like '%,' || p_modulo || '.' || p_perm || ',%'
$f$;

create table public.sf_posto_perfis (chave text primary key, recurso text not null);
create table public.sf_postos (chave text primary key, perfil text references public.sf_posto_perfis(chave));

create table public.sf_ordens (
  id uuid primary key default gen_random_uuid(),
  pmo text not null, op text not null,
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
  numero_serie_norm text not null default '',
  codigo_defeito text not null default '',
  nqa_visual text not null default '',
  nqa_funcional text not null default '',
  observacao text not null default '',
  posto_retorno text,
  posto_origem text
);

create table public.sf_caixas (
  id uuid primary key default gen_random_uuid(),
  pmo text not null, op text not null, posto text not null, seq int not null,
  limite int not null, qtd int not null default 0, codigo text not null default '',
  fechada boolean not null default false, ultima boolean not null default false,
  revisao int not null default 0,
  created_at timestamptz not null default now(), fechada_em timestamptz,
  unique (pmo, op, posto, seq, revisao)
);

-- Tabela NQA (0010) com faixas de verdade (nível II): o que muda com placas é a FAIXA escolhida.
create table public.tabela_nqa (
  id uuid primary key default gen_random_uuid(),
  quantidade_min int not null, quantidade_max int, tamanho_amostra numeric, ordem int not null default 0
);
insert into public.tabela_nqa (ordem, quantidade_min, quantidade_max, tamanho_amostra) values
  (1, 2, 8, 2), (2, 9, 15, 3), (3, 16, 25, 5), (4, 26, 50, 8), (5, 51, 90, 13), (6, 91, 150, 20),
  (7, 151, 280, 32), (8, 281, 500, 50), (9, 501, 1200, 80), (10, 1201, 3200, 125), (11, 3201, null, 200);

-- Espião no lugar da sf_aposentar_caixa (0100): a foto registra COM QUE POSTO ela foi chamada.
create table public.teste_aposentadas (pmo text, op text, posto text, numero_caixa text);
create function public.sf_aposentar_caixa(p_pmo text, p_op text, p_posto text, p_numero_caixa text)
returns jsonb language plpgsql as $f$
begin
  insert into public.teste_aposentadas values (p_pmo, p_op, p_posto, p_numero_caixa);
  return jsonb_build_object('ok', true);
end $f$;

insert into public.sf_posto_perfis (chave, recurso) values
  ('passagem', 'nenhum'), ('embalagem', 'caixa'), ('nqa', 'nqa'), ('almoxarifado', 'almoxarifado');
insert into public.sf_postos (chave, perfil) values
  ('Teste', 'passagem'), ('Manutenção', 'passagem'), ('Embalagem', 'embalagem'),
  ('Inspeção NQA', 'nqa'), ('Almoxarifado', 'almoxarifado');
