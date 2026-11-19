-- Esquema mínimo, além do estrutura_op_esquema.sql, para testar a 0195: o que a sf_integrar (0066) lê e grava.
-- tem_permissao de 1 argumento (a forma que a sf_integrar usa): `teste.perms` vazio = tudo liberado, como a de 2.
create or replace function public.tem_permissao(p_acao text) returns boolean language sql stable as $f$
  select coalesce(current_setting('teste.perms', true), '') = ''
      or (',' || current_setting('teste.perms', true) || ',') like '%,' || p_acao || ',%'
$f$;
-- os perfis dos postos (0062): tem_status decide se o fim do trecho exige Aprovado
create table public.sf_posto_perfis (
  chave text primary key, tem_status boolean not null, gate text not null default 'registrado',
  recurso text not null default 'nenhum');
alter table public.sf_postos add column perfil text references public.sf_posto_perfis(chave);
insert into public.sf_posto_perfis (chave, tem_status, gate, recurso) values
  ('passagem', false, 'registrado', 'nenhum'), ('inspecao', true, 'aprovado', 'nenhum'),
  ('spi', true, 'aprovado', 'nenhum'), ('teste', true, 'aprovado', 'nenhum'),
  ('integracao', false, 'registrado', 'integracao'), ('almox', false, 'registrado', 'almoxarifado');
insert into public.sf_postos (chave, ordem) values ('Integração', 10), ('Burn-in', 11) on conflict do nothing;
update public.sf_postos set perfil = case
  when chave in ('Inspeção AOI TOP', 'Inspeção PTH') then 'inspecao'
  when chave = 'SPI' then 'spi'
  when chave = 'Teste' then 'teste'
  when chave = 'Integração' then 'integracao'
  when chave = 'Almoxarifado' then 'almox'
  else 'passagem' end;
-- as colunas do registro que a Integração grava
alter table public.sf_registros add column colaborador text not null default '', add column cliente text not null default '',
  add column id_integracao text;
-- 0032/0066 (o necessário): a integração e as placas dela
create table public.sf_integracoes (
  id uuid primary key default gen_random_uuid(), codigo text not null unique, data_hora timestamptz not null default now(),
  colaborador text not null, cliente text not null default '', pmo text not null, op text not null,
  produto_sn text not null, produto_sn_norm text not null, qtd_placas int not null default 0,
  status text not null default 'ATIVA');
create table public.sf_integracao_itens (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid not null references public.sf_integracoes(id) on delete cascade,
  placa_pmo text not null default '', placa_op text not null default '', placa_sn text not null, placa_sn_norm text not null);
-- as colunas da OP que a sf_ordem_regravar_trechos grava (0145/0148)
alter table public.sf_ordens add column if not exists reaberta_manual boolean not null default false,
  add column if not exists updated_at timestamptz;
