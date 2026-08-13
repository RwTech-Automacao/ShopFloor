-- =============================================================
-- Embalagem individual: algumas OPs embalam 1 produto por caixa, e a caixa tem um Nº de Série
-- próprio que deve ser IGUAL ao do produto. Flag fixo na OP (definido no cadastro da OP): quando
-- true, o posto Embalagem mostra o fluxo de conferência (SN produto == SN caixa) em vez do coletivo.
-- =============================================================
alter table public.sf_ordens
  add column embalagem_individual boolean not null default false;
