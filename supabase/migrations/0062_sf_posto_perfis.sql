create table public.sf_posto_perfis (
  chave           text primary key,        -- 'passagem','inspecao','teste','spi','nqa','embalagem','integracao','burnin','manutencao'
  nome            text not null,           -- rótulo p/ a tela
  tem_status      boolean not null,        -- grava aprovado/reprovado
  reprova         text not null,           -- 'defeitos' | 'posicoes' | 'nenhum'
  gate            text not null,           -- 'aprovado' | 'registrado' (gate de sequência do posto anterior)
  exige_manutencao boolean not null,       -- reprova exige passar pela Manutenção
  recurso         text not null            -- 'nenhum'|'caixa'|'nqa'|'integracao'|'burnin'|'manutencao'
);
alter table public.sf_posto_perfis enable row level security;
-- leitura p/ o módulo; escrita não é exposta na Fase 1 (perfis são seed fixo)
create policy sf_posto_perfis_select on public.sf_posto_perfis for select using (tem_permissao('shopfloor','visualizar'));

insert into public.sf_posto_perfis (chave, nome, tem_status, reprova, gate, exige_manutencao, recurso) values
  ('passagem',   'Passagem',            false, 'nenhum',   'registrado', false, 'nenhum'),
  ('inspecao',   'Inspeção (defeitos)', true,  'defeitos', 'aprovado',   false, 'nenhum'),
  ('teste',      'Teste (c/ manutenção)', true,'defeitos', 'aprovado',   true,  'nenhum'),
  ('spi',        'Inspeção SPI',        true,  'posicoes', 'aprovado',   false, 'nenhum'),
  ('nqa',        'Inspeção NQA',        true,  'nenhum',   'aprovado',   false, 'nqa'),
  ('embalagem',  'Embalagem',           false, 'nenhum',   'registrado', false, 'caixa'),
  ('integracao', 'Integração',          false, 'nenhum',   'registrado', false, 'integracao'),
  ('burnin',     'Burn-in',             true,  'defeitos', 'registrado', true,  'burnin'),
  ('manutencao', 'Manutenção',          false, 'nenhum',   'registrado', false, 'manutencao');

alter table public.sf_postos add column if not exists perfil text references public.sf_posto_perfis(chave);

-- Backfill dos postos atuais (nome → perfil):
update public.sf_postos set perfil = 'passagem'  where chave in ('Inicial','Montagem PTH','Extra máquina');
update public.sf_postos set perfil = 'inspecao'  where chave in ('Inspeção SMD','Inspeção PTH','Inspeção Final');
update public.sf_postos set perfil = 'teste'     where chave in ('Teste','Teste Final');
update public.sf_postos set perfil = 'spi'        where chave = 'Inspeção SPI';
update public.sf_postos set perfil = 'nqa'        where chave = 'Inspeção NQA';
update public.sf_postos set perfil = 'embalagem'  where chave = 'Embalagem';
update public.sf_postos set perfil = 'integracao' where chave = 'Integração';
update public.sf_postos set perfil = 'burnin'     where chave = 'Burn-in';
update public.sf_postos set perfil = 'manutencao' where chave = 'Manutenção';
-- fallback defensivo (qualquer posto sem perfil → passagem)
update public.sf_postos set perfil = 'passagem' where perfil is null;
